"""Stage 8 — one Blender scene per situation."""

from __future__ import annotations

import json

from .. import config as cfg
from ..pipeline import Context, StageResult, stage
from ..util import blender


@stage(
    8, "scenes", "build a scene per preset",
    reads=("presets", "cameras", "scene"), after=("retarget", "presets"),
)
def build(ctx: Context) -> StageResult:
    presets_file = ctx.paths.presets / "presets.json"
    if not presets_file.exists():
        raise FileNotFoundError("stage 7 has not run; there are no presets to stage")
    presets = json.loads(presets_file.read_text(encoding="utf-8"))

    motion = ctx.paths.clean / "motion.npz"
    if not motion.exists():
        motion = ctx.paths.pose3d / "motion.npz"

    camera_names = ctx.config.get("cameras.use") or cfg.list_cameras(ctx.config.root)
    cameras = {name: cfg.load_camera(name, root=ctx.config.root) for name in camera_names}

    outputs, summary, warnings = [], {}, []
    for name, preset in presets.items():
        blend = ctx.paths.scenes / f"{name}.blend"
        result = blender.run_script(
            "bl_scene.py",
            {
                "motion": str(motion),
                "blend": str(blend),
                "preset": preset,
                "cameras": cameras,
                "ground": float(ctx.config.get("scene.ground", 10.0)),
            },
        )
        if not result.ok:
            warnings.append(f"{name}: scene build failed, see the log")
            result.check()
        outputs.append(blend)
        summary[name] = blender.tagged(result, "SCENE")

    return StageResult(
        outputs=outputs,
        summary={"scenes": len(outputs), "cameras": sorted(cameras), **summary},
        warnings=warnings,
    )
