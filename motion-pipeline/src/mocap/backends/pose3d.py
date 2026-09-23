"""Backends for stage 3: 2D keypoints (and the video) in, 3D joints out.

This is the stage with the real research in it, and none of that research
lives here. Every option is an adapter: either to a package you install, to a
program you run, or to a file somebody else produced. What this module owns is
the contract — metres, Y up, Z forward, SMPL's 24 joints, floor at zero — so
that whatever produced the motion, stage 4 onward cannot tell.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .. import skeleton
from ..io import Clip
from ..util.proc import run, which
from .registry import Availability, Backend, register


class Pose3DBackend:
    name = "base"

    def recover(self, clip: Clip, *, video: Path | None = None) -> Clip:
        raise NotImplementedError


def to_pipeline_frame(joints: np.ndarray, *, up: str = "y", forward: str = "z") -> np.ndarray:
    """Into this pipeline's axes: metres, Y up, Z forward, floor at zero.

    Most recoveries hand back Y-down (image convention) or Z-up (Blender's),
    and getting it wrong is invisible until the render, where the figure is
    upside down or walking into the camera. Converting at the boundary means
    only this function has to know.
    """
    array = np.asarray(joints, dtype=np.float64).copy()
    if up == "-y":
        array[:, :, 1] *= -1.0
    elif up == "z":
        array = array[:, :, [0, 2, 1]]
        array[:, :, 2] *= -1.0
    elif up != "y":
        raise ValueError(f"up must be y, -y or z; got {up!r}")
    if forward == "-z":
        array[:, :, 2] *= -1.0
        array[:, :, 0] *= -1.0
    elif forward != "z":
        raise ValueError(f"forward must be z or -z; got {forward!r}")

    # Floor at zero, taken from the feet rather than the lowest vertex: a
    # trailing toe should not lift the whole take.
    heights = array[:, list(skeleton.FOOT_JOINTS), 1]
    array[:, :, 1] -= float(np.percentile(heights, 2.0))
    return array


class SyntheticBackend(Pose3DBackend):
    """The built-in reference motion, ignoring whatever came from stage 2."""

    name = "synthetic"

    def __init__(self, degraded: bool = True, target_height: float = 0.86) -> None:
        self.degraded = degraded
        self.target_height = target_height

    def recover(self, clip: Clip, *, video: Path | None = None) -> Clip:
        from .. import synth  # noqa: PLC0415

        frames = clip.frames or 90
        joints = synth.front_kick(frames, clip.fps, target_height=self.target_height)
        if self.degraded:
            # Degraded on purpose: a stage-3 output that is already perfect
            # gives stages 4 and 6 nothing to find, and a pipeline you only
            # ever test on clean input is one you have not tested.
            joints = synth.degrade(joints)
        return Clip(
            fps=clip.fps,
            joints3d=joints,
            confidence=clip.confidence,
            keypoints2d=clip.keypoints2d,
            image_size=clip.image_size,
            provenance=list(clip.provenance),
        ).record("pose3d", backend=self.name, degraded=self.degraded)


class NpzImportBackend(Pose3DBackend):
    """Loads 3D joints somebody else recovered, from a .npz.

    Expects an array of (T, 24, 3) under one of a few common key names, plus
    an optional ``fps``. The axis convention is declared in config rather than
    guessed, because guessing it wrong is a silent 90-degree error.
    """

    name = "npz_import"

    def __init__(self, path: Path, *, up: str = "y", forward: str = "z", scale: float = 1.0) -> None:
        self.path = Path(path)
        self.up = up
        self.forward = forward
        self.scale = scale

    def recover(self, clip: Clip, *, video: Path | None = None) -> Clip:
        if not self.path.exists():
            raise FileNotFoundError(f"no 3D motion at {self.path}")
        with np.load(self.path, allow_pickle=False) as data:
            key = next(
                (k for k in ("joints3d", "joints", "keypoints3d", "pred_joints") if k in data.files),
                None,
            )
            if key is None:
                raise KeyError(
                    f"{self.path.name} has no joint array. Looked for joints3d, "
                    f"joints, keypoints3d, pred_joints; found {', '.join(data.files)}"
                )
            joints = np.asarray(data[key], dtype=np.float64) * self.scale
            fps = float(data["fps"]) if "fps" in data.files else clip.fps

        if joints.shape[1] != skeleton.NUM_JOINTS:
            raise ValueError(
                f"{self.path.name} has {joints.shape[1]} joints; this pipeline "
                f"uses SMPL's {skeleton.NUM_JOINTS}. Convert before importing."
            )
        return Clip(
            fps=fps,
            joints3d=to_pipeline_frame(joints, up=self.up, forward=self.forward),
            confidence=clip.confidence,
            image_size=clip.image_size,
            provenance=list(clip.provenance),
        ).record("pose3d", backend=self.name, source=str(self.path))


class SubprocessBackend(Pose3DBackend):
    """Runs an external recovery and reads what it writes.

    For 4D-Humans, HybrIK, WHAM, or anything else with a command line: they
    each want their own python environment, so calling one in-process would
    make this package depend on all of them at once. The command is a template
    from config; ``{video}``, ``{out}`` and ``{fps}`` are filled in.
    """

    name = "subprocess"

    def __init__(
        self,
        command: list[str],
        *,
        output: str = "motion.npz",
        up: str = "y",
        forward: str = "z",
        scale: float = 1.0,
        timeout: float = 7200.0,
    ) -> None:
        self.command = command
        self.output = output
        self.up = up
        self.forward = forward
        self.scale = scale
        self.timeout = timeout

    def recover(self, clip: Clip, *, video: Path | None = None) -> Clip:
        if video is None:
            raise ValueError("the subprocess backend needs the preprocessed video")
        work = video.parent / "recovery"
        work.mkdir(parents=True, exist_ok=True)
        target = work / self.output

        args = [
            part.format(video=str(video), out=str(target), fps=f"{clip.fps:g}", dir=str(work))
            for part in self.command
        ]
        if not which(args[0]) and not Path(args[0]).exists():
            raise FileNotFoundError(
                f"{args[0]} is not on PATH. Set pose3d.subprocess.command to the "
                "recovery you have installed; see docs/troubleshooting.md"
            )
        run(args, timeout=self.timeout).check()

        if not target.exists():
            produced = ", ".join(p.name for p in work.iterdir()) or "nothing"
            raise FileNotFoundError(
                f"{args[0]} finished but wrote no {target.name} (found: {produced}). "
                "Check pose3d.subprocess.output matches what it actually writes."
            )
        return NpzImportBackend(
            target, up=self.up, forward=self.forward, scale=self.scale
        ).recover(clip, video=video).record("pose3d", backend=self.name, command=args[0])


register(Backend(
    kind="pose3d", name="synthetic",
    summary="built-in reference motion, for testing the pipeline itself",
    check=lambda: Availability(True, "built in"),
    load=lambda: SyntheticBackend(),
    builtin=True,
))
register(Backend(
    kind="pose3d", name="npz_import",
    summary="load 3D joints recovered elsewhere (.npz)",
    check=lambda: Availability(True, "reads files; nothing to install"),
    load=lambda: NpzImportBackend(Path("motion.npz")),
    builtin=True,
))
register(Backend(
    kind="pose3d", name="subprocess",
    summary="run an external recovery (4D-Humans, HybrIK, WHAM, …)",
    check=lambda: Availability(True, "configure pose3d.subprocess.command"),
    load=lambda: SubprocessBackend(["echo"]),
    builtin=True,
))
