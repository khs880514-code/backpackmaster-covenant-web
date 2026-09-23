"""Stage 3 — lifting the detection into a body that stands in a room."""

from __future__ import annotations

from ..backends import pose3d as _pose3d  # noqa: F401 - registers the backends
from ..backends.registry import get
from ..io import Clip
from ..pipeline import Context, StageResult, stage


@stage(3, "pose3d", "recover 3D pose", reads=("pose3d",), after=("pose2d",))
def recover(ctx: Context) -> StageResult:
    name = ctx.config.get("pose3d.backend", "synthetic")
    backend = get("pose3d", name)
    state = backend.check()
    if not state.ok:
        raise RuntimeError(f"the '{name}' 3D backend is not usable: {state.detail}")

    options = dict(ctx.config.section(f"pose3d.{name}"))
    recovery = type(backend.load())(**options) if options else backend.load()

    clip = Clip.load(ctx.paths.pose2d / "keypoints")
    video = ctx.paths.video / "clip.mp4"
    result = recovery.recover(clip, video=video if video.stat().st_size else None)
    out = result.save(ctx.paths.pose3d / "motion")

    return StageResult(
        outputs=[out, out.with_suffix(".json")],
        summary={
            "backend": name,
            "frames": result.frames,
            "duration": round(result.duration, 3),
            "stature_estimate_m": _stature(result),
        },
    )


def _stature(clip: Clip) -> float | None:
    """Rough standing height, as a sanity check on the scale.

    A recovery that hands back centimetres, or a unit sphere, produces a
    figure a hundredth or a hundred times life size — and every downstream
    threshold is in metres. This is the cheapest place to notice.
    """
    import numpy as np

    from .. import skeleton

    if clip.joints3d is None:
        return None
    head = clip.joints3d[:, skeleton.INDEX["head"], 1]
    floor = np.percentile(clip.joints3d[:, list(skeleton.FOOT_JOINTS), 1], 2.0)
    return round(float(np.median(head) - floor) * 1.13, 3)
