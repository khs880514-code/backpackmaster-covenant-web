"""Stage 4 — is this take worth retargeting."""

from __future__ import annotations

from ..contact import ContactSettings
from ..io import Clip
from ..pipeline import Context, StageResult, stage
from ..quality import metrics, report


@stage(
    4, "quality", "grade the recovered motion",
    reads=("quality", "contact"), after=("pose3d",),
)
def grade(ctx: Context) -> StageResult:
    clip = Clip.load(ctx.paths.pose3d / "motion")
    if clip.joints3d is None:
        raise ValueError("stage 3 produced no 3D joints")

    contact = ContactSettings(**ctx.config.section("contact"))
    assessment = metrics.assess(
        clip.joints3d,
        clip.fps,
        confidence=clip.confidence,
        contact_settings=contact,
        thresholds=ctx.config.section("quality.thresholds"),
    )
    files = report.write(assessment, ctx.paths.quality, title=ctx.source_id)

    warnings = [
        f"{m.title}: {m.value:.3g}{m.unit} ({m.verdict})"
        for m in assessment.metrics
        if m.verdict != "pass"
    ]
    if assessment.recoverable_faults:
        warnings.append(
            "the above are what stage 6 exists to remove; it re-grades afterwards"
        )

    # Only what the cleanup cannot help with stops the run here. Jitter, a
    # sliding foot and a rubber skeleton are stage 6's job, and failing the
    # take for them would mean never reaching the stage that fixes them.
    fatal = assessment.unrecoverable
    if fatal and not ctx.config.get("quality.allow_poor", False):
        detail = "; ".join(f"{m.title} {m.value:.3g}{m.unit}" for m in fatal)
        raise RuntimeError(
            f"{ctx.source_id} cannot be recovered: {detail}\n"
            f"  Full report: {files[0]}\n"
            "  The subject was not visible enough to reconstruct. Re-shoot, or "
            "re-run with --allow-poor to look at it anyway."
        )

    return StageResult(
        outputs=list(files),
        summary={"verdict": assessment.verdict, **{m.key: round(m.value, 4) for m in assessment.metrics}},
        warnings=warnings,
    )
