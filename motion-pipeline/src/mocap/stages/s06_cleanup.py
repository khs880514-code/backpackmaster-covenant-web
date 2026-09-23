"""Stage 6 — foot lock, pelvis stabilization, root drift correction."""

from __future__ import annotations

import json

from ..cleanup import CleanupSettings, apply
from ..contact import ContactSettings
from ..io import Clip
from ..pipeline import Context, StageResult, stage
from ..quality import metrics, report


@stage(
    6, "clean", "lock feet, steady the pelvis, remove drift",
    reads=("cleanup", "contact"), after=("pose3d",),
)
def clean(ctx: Context) -> StageResult:
    clip = Clip.load(ctx.paths.pose3d / "motion")
    if clip.joints3d is None:
        raise ValueError("stage 3 produced no 3D joints")

    section = dict(ctx.config.section("cleanup"))
    settings = CleanupSettings(
        **{k: v for k, v in section.items() if k != "contact"},
        contact=ContactSettings(**ctx.config.section("contact")),
    )
    joints, cleanup_report = apply(clip.joints3d, clip.fps, settings)

    cleaned = Clip(
        fps=clip.fps,
        joints3d=joints,
        confidence=clip.confidence,
        image_size=clip.image_size,
        provenance=list(clip.provenance),
    ).record("clean", **cleanup_report.as_dict())
    out = cleaned.save(ctx.paths.clean / "motion")

    (ctx.paths.clean / "cleanup.json").write_text(
        json.dumps(cleanup_report.as_dict(), indent=2) + "\n", encoding="utf-8"
    )

    # Re-grade, so the run records what the cleanup actually bought rather
    # than what it was expected to.
    after = metrics.assess(
        joints, clip.fps, confidence=clip.confidence,
        contact_settings=settings.contact,
        thresholds=ctx.config.section("quality.thresholds"),
    )
    report.write(after, ctx.paths.clean, title=f"{ctx.source_id} (cleaned)")

    warnings = list(cleanup_report.notes)
    remaining = [m for m in after.metrics if m.verdict != "pass"]
    warnings += [f"still {m.verdict}: {m.title} {m.value:.3g}{m.unit}" for m in remaining]

    # This is the real gate. Stage 4 grades what came out of the recovery;
    # this grades what is actually going to be retargeted, which is the take
    # after everything that can be done to it has been.
    if after.verdict == "fail" and not ctx.config.get("quality.allow_poor", False):
        detail = "; ".join(
            f"{m.title} {m.value:.3g}{m.unit}" for m in after.metrics if m.verdict == "fail"
        )
        raise RuntimeError(
            f"{ctx.source_id} still fails after cleanup: {detail}\n"
            f"  Report: {ctx.paths.clean / 'quality.md'}\n"
            "  Try a longer cleanup.smooth_seconds, or check docs/troubleshooting.md."
        )

    return StageResult(
        outputs=[out, out.with_suffix(".json"), ctx.paths.clean / "cleanup.json"],
        summary={"verdict_after": after.verdict, **cleanup_report.as_dict()},
        warnings=warnings,
    )
