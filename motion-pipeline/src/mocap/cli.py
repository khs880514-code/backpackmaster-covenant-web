"""``mocap`` — the command line.

Everything the pipeline does is reachable from here, and nothing here needs a
network or a model to tell you whether it will work: ``mocap doctor`` reports
what is installed before a run starts, and ``mocap demo`` runs the whole thing
on the built-in fixture so a change can be exercised on any machine.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config as cfg
from . import partner
from .pipeline import Context, RunPaths, in_dependency_order, ordered_stages, resolve_selection
from .pipeline import run as run_stages
from .util.log import configure, get_logger

# Importing the stage modules is what registers them.
from .stages import (  # noqa: F401,E402
    s01_preprocess, s02_pose2d, s03_pose3d, s04_quality, s05_retarget,
    s06_cleanup, s07_presets, s08_scenes, s09_render,
)
from .backends import pose2d as _b2, pose3d as _b3  # noqa: F401,E402
from .backends.registry import available


def _context(args: argparse.Namespace, source: str | None) -> Context:
    overrides = list(args.set or [])
    if getattr(args, "allow_poor", False):
        overrides.append("quality.allow_poor=true")
    config = cfg.load(source, root=args.root, overrides=overrides)
    runs = Path(args.out) if args.out else config.root / "runs"
    return Context(
        config=config,
        paths=RunPaths(runs / (source or "unnamed")),
        force=bool(getattr(args, "force", False)),
        dry_run=bool(getattr(args, "dry_run", False)),
    )


def cmd_run(args: argparse.Namespace) -> int:
    log = get_logger()
    sources = args.source or cfg.list_sources(args.root)
    if not sources:
        log.error("no sources configured. See configs/sources/ or `mocap sources`.")
        return 2

    failures = 0
    for source in sources:
        log.info("=== %s ===", source)
        ctx = _context(args, source)
        try:
            results = run_stages(ctx, resolve_selection(args.stages))
        except Exception as exc:  # noqa: BLE001 - reported, run continues
            log.error("%s failed: %s", source, exc)
            failures += 1
            continue
        produced = sum(len(r.outputs) for r in results.values())
        log.info("%s · %d stages, %d files, under %s", source, len(results), produced, ctx.paths.root)
    return 1 if failures else 0


def cmd_doctor(args: argparse.Namespace) -> int:
    from .util import blender
    from .util.proc import which

    print("Tools")
    for tool, why in (
        ("ffmpeg", "stage 1 and stage 9"),
        ("ffprobe", "stage 1"),
        ("blender", "stages 5, 8 and 9"),
    ):
        found = which(tool)
        print(f"  {'ok' if found else '--'}  {tool:9} {found or 'not found'}  ({why})")

    version = blender.version()
    if version:
        print(f"      {version}")
        ok, detail = _blender_numpy()
        print(f"  {'ok' if ok else '--'}  blender numpy   {detail}")

    for kind in ("pose2d", "pose3d"):
        print(f"\nBackends · {kind}")
        for backend in available(kind):  # type: ignore[arg-type]
            state = backend.check()
            mark = "ok" if state.ok else "--"
            print(f"  {mark}  {backend.name:15} {backend.summary}")
            if not state.ok:
                print(f"      {state.detail}")

    print("\nConfigured")
    print(f"  sources  {', '.join(cfg.list_sources(args.root)) or 'none'}")
    print(f"  presets  {', '.join(cfg.list_presets(args.root)) or 'none'}")
    print(f"  cameras  {', '.join(cfg.list_cameras(args.root)) or 'none'}")
    return 0


def _blender_numpy() -> tuple[bool, str]:
    """Blender's own Python needs numpy, and it is not always the one that has it.

    A distribution build often links the system interpreter, so `pip install
    numpy` into the python on PATH can leave Blender without it — which fails
    at stage 5 with a bare ImportError and no clue why.
    """
    from .util.proc import require, run

    try:
        binary = require("blender")
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)
    result = run(
        [binary, "-b", "--factory-startup", "--python-expr",
         "import numpy,sys;print('NUMPY',numpy.__version__,sys.version.split()[0])"],
        timeout=300,
    )
    for line in result.stdout.splitlines():
        if line.startswith("NUMPY"):
            _, numpy_version, python_version = line.split()
            return True, f"numpy {numpy_version} under Blender's python {python_version}"
    return False, (
        "Blender's python cannot import numpy. On Debian/Ubuntu: "
        "apt-get install python3-numpy (Blender uses the system python there)"
    )


def cmd_stages(args: argparse.Namespace) -> int:
    order = {spec.name: i for i, spec in enumerate(in_dependency_order(ordered_stages()))}
    print(f"{'#':>2}  {'name':11} {'runs':>4}  what it does")
    for spec in ordered_stages():
        needs = f" (after {', '.join(spec.after)})" if spec.after else ""
        print(f"{spec.number:2d}  {spec.name:11} {order[spec.name] + 1:4d}  {spec.title}{needs}")
    print("\n'runs' is the execution order: a stage never runs before what it reads.")
    return 0


def cmd_sources(args: argparse.Namespace) -> int:
    for name in cfg.list_sources(args.root):
        config = cfg.load(name, root=args.root)
        video = config.get("source.video") or "(fixture — no video)"
        print(f"  {name:22} {config.get('source.title', '')}\n{'':24}{video}")
    return 0


def cmd_presets(args: argparse.Namespace) -> int:
    if args.preset_command == "list":
        for name in cfg.list_presets(args.root):
            spec = cfg.load_preset(name, root=args.root)
            posture = spec.get("posture", name)
            pose = partner.build(posture)
            print(
                f"  {name:14} posture={posture:12} target={spec.get('target_height', pose.target_height):.2f}m "
                f"facing={spec.get('facing', pose.facing):.0f}°  {spec.get('description', pose.description)}"
            )
        return 0
    if args.preset_command == "postures":
        for name in partner.names():
            pose = partner.build(name)
            print(f"  {name:14} target={pose.target_height:.2f}m facing={pose.facing:.0f}°  {pose.description}")
        return 0
    return 2


def cmd_demo(args: argparse.Namespace) -> int:
    """The whole pipeline on the built-in fixture, with nothing installed but
    Blender and ffmpeg. What `make test` would run if this were a C project."""
    log = get_logger()
    args.source = [args.name]
    args.stages = args.stages or None
    log.info("running the fixture end to end — no video, no model weights")
    return cmd_run(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mocap",
        description="Motion capture pipeline for self-defence demonstration video.",
    )
    parser.add_argument("--root", type=Path, default=None, help="project root (default: found upward)")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("-q", "--quiet", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--set", action="append", metavar="KEY=VALUE", help="override any setting")
        p.add_argument("--out", type=Path, default=None, help="where runs are written")
        p.add_argument("--force", action="store_true", help="redo stages even if cached")
        p.add_argument("--dry-run", action="store_true", help="say what would run")
        p.add_argument("--allow-poor", action="store_true", help="continue past a failed quality gate")

    run_cmd = sub.add_parser("run", help="run the pipeline")
    run_cmd.add_argument("source", nargs="*", help="source ids (default: all)")
    run_cmd.add_argument("--stages", default=None, help="e.g. 3, 2-6, clean,render")
    common(run_cmd)
    run_cmd.set_defaults(func=cmd_run)

    demo = sub.add_parser("demo", help="run the built-in fixture end to end")
    demo.add_argument("--name", default="fixture", help="source id to use")
    demo.add_argument("--stages", default=None)
    common(demo)
    demo.set_defaults(func=cmd_demo)

    doctor = sub.add_parser("doctor", help="what is installed and what is missing")
    doctor.set_defaults(func=cmd_doctor)

    stages_cmd = sub.add_parser("stages", help="list the stages")
    stages_cmd.set_defaults(func=cmd_stages)

    sources = sub.add_parser("sources", help="list configured sources")
    sources.set_defaults(func=cmd_sources)

    presets = sub.add_parser("presets", help="partner pose presets")
    preset_sub = presets.add_subparsers(dest="preset_command", required=True)
    preset_sub.add_parser("list", help="configured presets")
    preset_sub.add_parser("postures", help="postures a preset can ask for")
    presets.set_defaults(func=cmd_presets)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    configure(verbose=args.verbose, quiet=args.quiet)
    try:
        return int(args.func(args))
    except cfg.ConfigError as exc:
        get_logger().error("%s", exc)
        return 2
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
