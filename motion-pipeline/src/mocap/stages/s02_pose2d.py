"""Stage 2 — where the body is in each frame."""

from __future__ import annotations

from ..backends import pose2d as _pose2d  # noqa: F401 - registers the backends
from ..backends.registry import get
from ..io import Clip
from ..pipeline import Context, StageResult, stage


@stage(2, "pose2d", "detect 2D keypoints", reads=("pose2d",), after=("preprocess",))
def detect(ctx: Context) -> StageResult:
    name = ctx.config.get("pose2d.backend", "synthetic")
    backend = get("pose2d", name)
    state = backend.check()
    if not state.ok:
        raise RuntimeError(
            f"the '{name}' 2D backend is not usable: {state.detail}\n"
            "  Run `mocap doctor` to see what is installed."
        )

    options = ctx.config.section(f"pose2d.{name}")
    detector = type(backend.load())(**options) if options else backend.load()

    video = ctx.paths.video / "clip.mp4"
    fps = float(ctx.config.get("preprocess.fps", 30.0))
    clip: Clip = detector.detect(video, fps=fps, every=int(ctx.config.get("pose2d.every", 1)))
    out = clip.save(ctx.paths.pose2d / "keypoints")

    seen = float((clip.confidence >= 0.3).mean()) if clip.confidence is not None else 1.0
    warnings = []
    if seen < 0.9:
        warnings.append(
            f"only {seen * 100:.0f}% of joint-frames were seen — check framing and lighting"
        )
    return StageResult(
        outputs=[out, out.with_suffix(".json")],
        summary={"backend": name, "frames": clip.frames, "seen": round(seen, 4)},
        warnings=warnings,
    )
