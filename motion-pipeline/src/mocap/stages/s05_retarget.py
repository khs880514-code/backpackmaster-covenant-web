"""Stage 5 — the motion onto an armature that can be posed and rendered."""

from __future__ import annotations

from ..pipeline import Context, StageResult, stage
from ..util import blender


@stage(
    5, "retarget", "put the motion on an armature",
    reads=("retarget", "scene.character"), after=("clean",),
)
def retarget(ctx: Context) -> StageResult:
    # The cleaned take when stage 6 has run, the raw one when it has not —
    # so stage 5 can be exercised on its own during setup.
    source = ctx.paths.clean / "motion.npz"
    if not source.exists():
        source = ctx.paths.pose3d / "motion.npz"
    if not source.exists():
        raise FileNotFoundError(
            "no motion to retarget; run stages 3 and 6 first "
            "(`mocap run --stages 1-6`)"
        )

    blend = ctx.paths.retarget / "rig.blend"
    export = ctx.config.get("retarget.export")
    options = {
        "motion": str(source),
        "blend": str(blend),
        "name": ctx.config.get("retarget.name", "Demonstrator"),
        "stand_in": bool(ctx.config.get("retarget.stand_in", True)),
    }
    character = ctx.config.get("scene.character")
    if character:
        options["character"] = str(character)
    if export:
        options["export"] = str(ctx.paths.retarget / export)

    result = blender.run_script("bl_retarget.py", options).check()
    summary = blender.tagged(result, "RETARGET")

    outputs = [blend]
    if export:
        outputs.append(ctx.paths.retarget / export)

    warnings = []
    if character and summary.get("matched") in ("0", 0):
        warnings.append("character armature matched no joint names; using the stand-in")
    return StageResult(outputs=outputs, summary={"source": str(source), **summary}, warnings=warnings)
