"""Stage 9 — playblast to check, render to keep, mp4 to send."""

from __future__ import annotations

import json

from .. import config as cfg
from ..pipeline import Context, StageResult, stage
from ..util import blender
from ..util import video as vid


@stage(9, "render", "render the demonstrations", reads=("render", "cameras"), after=("scenes",))
def render(ctx: Context) -> StageResult:
    scenes = sorted(ctx.paths.scenes.glob("*.blend"))
    if not scenes:
        raise FileNotFoundError("stage 8 has not run; there are no scenes to render")

    camera_names = ctx.config.get("cameras.use") or cfg.list_cameras(ctx.config.root)
    settings = ctx.config.section("render")
    quality = str(settings.get("quality", "final"))
    fps = float(ctx.config.get("preprocess.fps", 30.0))
    width = int(settings.get("width", 1920))
    height = int(settings.get("height", 1080))
    if quality == "playblast":
        width, height = width // 2, height // 2

    outputs, summary, warnings = [], {}, []
    for blend in scenes:
        clips = {}
        for camera in camera_names:
            frames_dir = ctx.paths.renders / blend.stem / camera
            result = blender.run_script(
                "bl_render.py",
                {
                    "blend": str(blend),
                    "camera": camera,
                    "frames": str(frames_dir),
                    "quality": quality,
                    "width": width,
                    "height": height,
                    "samples": int(settings.get("samples", 32)),
                    "step": int(settings.get("step", 1)),
                },
            )
            if not result.ok:
                warnings.append(f"{blend.stem}/{camera}: render failed")
                result.check()
            info = blender.tagged(result, "RENDER")
            if not info.get("frames"):
                warnings.append(f"{blend.stem}/{camera}: rendered no frames")
                continue

            mp4 = ctx.paths.renders / f"{blend.stem}_{camera}.mp4"
            vid.encode_frames(frames_dir / "f_*.png", mp4, fps=fps, crf=int(settings.get("crf", 18)))
            clips[camera] = mp4
            outputs.append(mp4)
            if not settings.get("keep_frames", False):
                for png in frames_dir.glob("f_*.png"):
                    png.unlink()

        # Front and side together: the form a demonstration is watched in.
        if settings.get("side_by_side", True) and len(clips) >= 2:
            first, second = list(clips)[:2]
            pair = ctx.paths.renders / f"{blend.stem}_{first}-{second}.mp4"
            vid.stack(clips[first], clips[second], pair, labels=(first, second))
            outputs.append(pair)

        summary[blend.stem] = sorted(c.name for c in clips.values())

    index = ctx.paths.renders / "index.json"
    index.write_text(
        json.dumps({"quality": quality, "clips": summary}, indent=2) + "\n", encoding="utf-8"
    )
    outputs.append(index)
    return StageResult(outputs=outputs, summary={"quality": quality, **summary}, warnings=warnings)
