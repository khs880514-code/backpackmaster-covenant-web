"""Stage 7 — resolve the partner poses a demonstration is staged against.

A preset is the situation, not the character: which posture the partner is in,
how far away, which way round, and what height the technique is aimed at. The
pose itself is generated, so a preset stays a text file.
"""

from __future__ import annotations

import json

from .. import config as cfg
from .. import partner
from ..pipeline import Context, StageResult, stage


@stage(7, "presets", "resolve the partner poses", reads=("presets", "scene.stature"))
def resolve(ctx: Context) -> StageResult:
    wanted = ctx.config.get("presets.use") or cfg.list_presets(ctx.config.root)
    if not wanted:
        raise RuntimeError(
            "no presets configured and none found in configs/presets/. "
            "Run `mocap presets list`."
        )

    stature = float(ctx.config.get("scene.stature", 1.75))
    resolved: dict[str, dict] = {}
    warnings: list[str] = []

    for name in wanted:
        spec = cfg.load_preset(name, root=ctx.config.root)
        posture = spec.get("posture", name)
        try:
            pose = partner.build(posture, stature=float(spec.get("stature", stature)))
        except KeyError as exc:
            raise RuntimeError(
                f"preset '{name}' asks for posture '{posture}', which does not exist. "
                f"Known postures: {', '.join(partner.names())}"
            ) from exc

        entry = {
            "name": name,
            "posture": posture,
            "description": spec.get("description", pose.description),
            "joints": pose.joints.round(6).tolist(),
            "target_height": float(spec.get("target_height", pose.target_height)),
            "facing": float(spec.get("facing", pose.facing)),
            "distance": float(spec.get("distance", 1.05)),
            "offset": float(spec.get("offset", 0.0)),
        }
        if entry["distance"] < 0.5:
            warnings.append(f"{name}: distance {entry['distance']}m puts the figures inside each other")
        resolved[name] = entry

    out = ctx.paths.presets / "presets.json"
    out.write_text(json.dumps(resolved, indent=2) + "\n", encoding="utf-8")
    return StageResult(
        outputs=[out],
        summary={
            "count": len(resolved),
            "presets": {
                k: {"posture": v["posture"], "target_height": v["target_height"], "facing": v["facing"]}
                for k, v in resolved.items()
            },
        },
        warnings=warnings,
    )
