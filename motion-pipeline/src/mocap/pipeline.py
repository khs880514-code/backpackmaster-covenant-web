"""The stage framework: what a stage is, and what running one means.

Every stage declares what it reads and what it writes, and records a
fingerprint of both when it finishes. A re-run that finds the fingerprint
unchanged skips the work. That is the whole of the caching, and it is what
makes it reasonable to iterate on stage 6 without re-detecting poses for
twenty minutes first.
"""

from __future__ import annotations

import json
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Protocol, Sequence

from .config import Config
from .util.log import get_logger

STAGES: dict[str, "StageSpec"] = {}


@dataclass(slots=True)
class RunPaths:
    """Where one take's intermediates live.

    Flat and numbered, so `ls` reads as the pipeline order and a half-finished
    run says at a glance where it stopped.
    """

    root: Path

    @property
    def video(self) -> Path:
        return self.root / "01_preprocess"

    @property
    def pose2d(self) -> Path:
        return self.root / "02_pose2d"

    @property
    def pose3d(self) -> Path:
        return self.root / "03_pose3d"

    @property
    def quality(self) -> Path:
        return self.root / "04_quality"

    @property
    def retarget(self) -> Path:
        return self.root / "05_retarget"

    @property
    def clean(self) -> Path:
        return self.root / "06_clean"

    @property
    def presets(self) -> Path:
        return self.root / "07_presets"

    @property
    def scenes(self) -> Path:
        return self.root / "08_scenes"

    @property
    def renders(self) -> Path:
        return self.root / "09_render"

    @property
    def state(self) -> Path:
        return self.root / ".state"

    def prepare(self) -> None:
        for directory in (
            self.video, self.pose2d, self.pose3d, self.quality, self.retarget,
            self.clean, self.presets, self.scenes, self.renders, self.state,
        ):
            directory.mkdir(parents=True, exist_ok=True)


@dataclass(slots=True)
class Context:
    """Everything a stage is given."""

    config: Config
    paths: RunPaths
    force: bool = False
    dry_run: bool = False
    log: object = field(default=None)

    def __post_init__(self) -> None:
        if self.log is None:
            self.log = get_logger("mocap")

    @property
    def source_id(self) -> str:
        return self.config.get("source.id", "unnamed")


class StageFn(Protocol):
    def __call__(self, ctx: Context) -> "StageResult": ...


@dataclass(slots=True)
class StageResult:
    """What a stage says about what it did."""

    outputs: list[Path] = field(default_factory=list)
    #: Anything worth putting in the run log or the quality report.
    summary: dict[str, object] = field(default_factory=dict)
    #: Things that did not stop the stage but that somebody should read.
    warnings: list[str] = field(default_factory=list)
    skipped: bool = False


@dataclass(slots=True)
class StageSpec:
    number: int
    name: str
    title: str
    run: StageFn
    #: Configuration paths this stage reads. Only these go in its fingerprint,
    #: so an unrelated setting does not invalidate its cached output.
    reads: tuple[str, ...] = ()
    #: Stages that must have produced output before this one can start.
    after: tuple[str, ...] = ()

    @property
    def label(self) -> str:
        return f"{self.number:02d}_{self.name}"


def stage(
    number: int,
    name: str,
    title: str,
    *,
    reads: Sequence[str] = (),
    after: Sequence[str] = (),
) -> Callable[[StageFn], StageFn]:
    """Registers a stage. Import the module and it is available to the CLI."""

    def decorate(fn: StageFn) -> StageFn:
        if name in STAGES:
            raise RuntimeError(f"stage {name} is registered twice")
        STAGES[name] = StageSpec(
            number=number,
            name=name,
            title=title,
            run=fn,
            reads=tuple(reads),
            after=tuple(after),
        )
        return fn

    return decorate


def ordered_stages() -> list[StageSpec]:
    """Every stage in the order it is listed."""
    return sorted(STAGES.values(), key=lambda s: s.number)


def in_dependency_order(specs: Iterable[StageSpec]) -> list[StageSpec]:
    """The same stages, but never before something they read from.

    The numbers are how the pipeline is talked about — "stage 6 is the foot
    lock" — and they are not always the order it runs in. Retargeting is
    stage 5 and reads the cleaned motion that stage 6 produces, so asking for
    both runs 6 first. Sorting by number alone would retarget the uncleaned
    take and silently produce a worse result than the one that was asked for.
    """
    chosen = {spec.name: spec for spec in specs}
    done: list[StageSpec] = []
    placed: set[str] = set()
    walking: set[str] = set()

    def visit(spec: StageSpec) -> None:
        if spec.name in placed:
            return
        if spec.name in walking:
            raise ValueError(f"stages depend on each other in a loop, at '{spec.name}'")
        walking.add(spec.name)
        for need in sorted(spec.after):
            # Only what was actually asked for: a stage whose input already
            # exists on disk does not need its producer run again.
            if need in chosen:
                visit(chosen[need])
        walking.discard(spec.name)
        placed.add(spec.name)
        done.append(spec)

    for spec in sorted(chosen.values(), key=lambda s: s.number):
        visit(spec)
    return done


def resolve_selection(selection: str | None) -> list[StageSpec]:
    """Turns ``3``, ``2-6``, ``pose2d,clean`` or None into stages to run."""
    every = ordered_stages()
    if not selection or selection == "all":
        return every

    by_number = {spec.number: spec for spec in every}
    chosen: list[StageSpec] = []
    for piece in selection.split(","):
        token = piece.strip()
        if not token:
            continue
        if "-" in token and all(part.strip().isdigit() for part in token.split("-", 1)):
            lo, hi = (int(part) for part in token.split("-", 1))
            chosen.extend(by_number[n] for n in range(lo, hi + 1) if n in by_number)
        elif token.isdigit():
            if int(token) not in by_number:
                raise ValueError(f"no stage numbered {token}")
            chosen.append(by_number[int(token)])
        elif token in STAGES:
            chosen.append(STAGES[token])
        else:
            known = ", ".join(s.name for s in every)
            raise ValueError(f"no stage '{token}'. Known stages: {known}")

    seen: set[str] = set()
    unique = [s for s in chosen if not (s.name in seen or seen.add(s.name))]
    return sorted(unique, key=lambda s: s.number)


def _state_file(ctx: Context, spec: StageSpec) -> Path:
    return ctx.paths.state / f"{spec.label}.json"


def _fingerprint(ctx: Context, spec: StageSpec) -> str:
    return ctx.config.fingerprint(*spec.reads) if spec.reads else "-"


def execute(ctx: Context, spec: StageSpec) -> StageResult:
    """Runs one stage, honouring the cache, and records what happened."""
    marker = _state_file(ctx, spec)
    want = _fingerprint(ctx, spec)

    if not ctx.force and marker.exists():
        try:
            previous = json.loads(marker.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous = {}
        outputs = [Path(p) for p in previous.get("outputs", [])]
        if (
            previous.get("fingerprint") == want
            and previous.get("ok") is True
            and outputs
            and all(p.exists() for p in outputs)
        ):
            ctx.log.info("%s · up to date, skipping", spec.label)
            return StageResult(outputs=outputs, summary=previous.get("summary", {}), skipped=True)

    ctx.log.info("%s · %s", spec.label, spec.title)
    if ctx.dry_run:
        return StageResult(skipped=True, summary={"dry_run": True})

    started = time.time()
    try:
        result = spec.run(ctx)
    except Exception as exc:  # noqa: BLE001 - recorded, then re-raised
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(
            json.dumps(
                {
                    "stage": spec.label,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(limit=6),
                    "finished": time.time(),
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        raise

    elapsed = time.time() - started
    for note in result.warnings:
        ctx.log.warning("%s · %s", spec.label, note)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        json.dumps(
            {
                "stage": spec.label,
                "ok": True,
                "fingerprint": want,
                "seconds": round(elapsed, 3),
                "outputs": [str(p) for p in result.outputs],
                "summary": result.summary,
                "warnings": result.warnings,
                "finished": time.time(),
            },
            indent=2,
            default=str,
        )
        + "\n",
        encoding="utf-8",
    )
    ctx.log.info("%s · done in %.1fs", spec.label, elapsed)
    return result


def run(ctx: Context, specs: Iterable[StageSpec]) -> dict[str, StageResult]:
    specs = in_dependency_order(specs)
    ctx.paths.prepare()
    ctx.config.dump(ctx.paths.root / "resolved-config.yaml")
    results: dict[str, StageResult] = {}
    for spec in specs:
        results[spec.name] = execute(ctx, spec)
    return results
