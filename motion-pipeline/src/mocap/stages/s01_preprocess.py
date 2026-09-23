"""Stage 1 — one normalized clip out of whatever was handed in.

Every later stage assumes frames arrive at a constant rate and a known size.
A phone recording provides neither: variable frame rate, a rotation flag the
player honours and the decoder does not, sometimes interlaced. Normalizing
once here is what lets stage 2 index frames by number and stage 6
differentiate by time without either carrying a timebase.
"""

from __future__ import annotations

from pathlib import Path

from ..pipeline import Context, StageResult, stage
from ..util import video as vid


@stage(
    1, "preprocess", "normalize the source video",
    reads=("source.video", "source.trim", "preprocess"),
)
def preprocess(ctx: Context) -> StageResult:
    raw = ctx.config.get("source.video")
    target = ctx.paths.video / "clip.mp4"
    warnings: list[str] = []

    if not raw:
        # No footage: the run is on the built-in fixture, and stages 2 and 3
        # say so too. Nothing to normalize, and nothing to pretend about.
        target.write_bytes(b"")
        return StageResult(
            outputs=[target],
            summary={"source": None, "note": "no video configured; fixture run"},
            warnings=["source.video is not set — stages 2 and 3 must use a synthetic backend"],
        )

    source = Path(raw)
    if not source.is_absolute():
        source = (ctx.config.root / source).resolve()
    if not source.exists():
        raise FileNotFoundError(
            f"source.video points at {source}, which does not exist.\n"
            "  Paths are relative to the project root."
        )

    info = vid.probe(source)
    settings = ctx.config.section("preprocess")
    fps = float(settings.get("fps") or info.fps or 30.0)
    height = settings.get("height")
    trim = ctx.config.section("source.trim") if ctx.config.get("source.trim") else {}

    if info.fps and abs(info.fps - fps) > 0.01:
        warnings.append(f"resampling {info.fps:g} fps to {fps:g} fps")
    if info.rotation:
        warnings.append(
            f"source carries a {info.rotation}° rotation flag; ffmpeg applies it, "
            "so the output is upright"
        )

    vid.transcode(
        source,
        target,
        fps=fps,
        height=int(height) if height else None,
        start=trim.get("start"),
        end=trim.get("end"),
        deinterlace=bool(settings.get("deinterlace", False)),
        stabilize=bool(settings.get("stabilize", False)),
        crf=int(settings.get("crf", 16)),
    )
    out = vid.probe(target)
    return StageResult(
        outputs=[target],
        summary={
            "source": str(source),
            "in": f"{info.width}x{info.height} {info.fps:g}fps {info.duration:.2f}s {info.codec}",
            "out": f"{out.width}x{out.height} {out.fps:g}fps {out.duration:.2f}s",
            "frames": out.frames,
        },
        warnings=warnings,
    )
