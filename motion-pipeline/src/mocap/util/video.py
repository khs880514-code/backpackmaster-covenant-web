"""ffmpeg and ffprobe, wrapped so the stages read as intent."""

from __future__ import annotations

import json
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from .proc import require, run


@dataclass(frozen=True, slots=True)
class VideoInfo:
    path: Path
    width: int
    height: int
    fps: float
    frames: int
    duration: float
    codec: str
    rotation: int = 0

    @property
    def portrait(self) -> bool:
        return self.height > self.width


def probe(path: str | Path) -> VideoInfo:
    """What a file actually contains, not what its name suggests."""
    source = Path(path)
    if not source.exists():
        raise FileNotFoundError(f"no video at {source}")
    ffprobe = require("ffprobe")
    result = run(
        [
            ffprobe, "-v", "error",
            "-select_streams", "v:0",
            "-show_entries",
            "stream=width,height,avg_frame_rate,nb_frames,codec_name,duration,side_data_list",
            "-show_entries", "format=duration",
            "-of", "json",
            str(source),
        ],
        timeout=120,
    ).check()

    payload = json.loads(result.stdout)
    streams = payload.get("streams") or []
    if not streams:
        raise ValueError(f"{source.name} has no video stream")
    stream = streams[0]

    rate = stream.get("avg_frame_rate", "0/0")
    try:
        fps = float(Fraction(rate)) if rate and rate != "0/0" else 0.0
    except (ZeroDivisionError, ValueError):
        fps = 0.0

    duration = float(
        stream.get("duration") or payload.get("format", {}).get("duration") or 0.0
    )
    frames = int(stream.get("nb_frames") or 0) or int(round(duration * fps))

    rotation = 0
    for side in stream.get("side_data_list", []) or []:
        if "rotation" in side:
            rotation = int(side["rotation"]) % 360

    return VideoInfo(
        path=source,
        width=int(stream["width"]),
        height=int(stream["height"]),
        fps=fps,
        frames=frames,
        duration=duration,
        codec=str(stream.get("codec_name", "?")),
        rotation=rotation,
    )


def transcode(
    source: Path,
    target: Path,
    *,
    fps: float,
    height: int | None = None,
    start: float | None = None,
    end: float | None = None,
    deinterlace: bool = False,
    stabilize: bool = False,
    crf: int = 16,
) -> Path:
    """One normalized clip: fixed frame rate, known size, no field artefacts.

    Every later stage assumes frames arrive at a constant rate; a phone
    recording rarely does. Normalizing once here is what lets stage 2 index
    frames by number and stage 6 differentiate by time without either of them
    carrying a timebase.
    """
    ffmpeg = require("ffmpeg")
    target.parent.mkdir(parents=True, exist_ok=True)

    filters: list[str] = []
    if deinterlace:
        filters.append("yadif=mode=1")
    # Deshake before scaling: it works in source pixels and crops as it goes.
    if stabilize:
        filters.append("deshake=rx=32:ry=32")
    filters.append(f"fps={fps:g}")
    if height:
        filters.append(f"scale=-2:{int(height)}:flags=lanczos")
    filters.append("format=yuv420p")

    args = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error"]
    # Seeking before -i is the fast path; the re-encode makes it frame-exact.
    if start is not None:
        args += ["-ss", f"{start:g}"]
    args += ["-i", str(source)]
    if end is not None:
        args += ["-to", f"{max(0.0, end - (start or 0.0)):g}"]
    args += [
        "-vf", ",".join(filters),
        "-an",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        str(target),
    ]
    run(args, timeout=3600).check()
    return target


def encode_frames(
    frames_glob: Path,
    target: Path,
    *,
    fps: float,
    crf: int = 18,
) -> Path:
    """Stills to mp4. What turns a render directory into something playable."""
    ffmpeg = require("ffmpeg")
    target.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", f"{fps:g}",
            "-pattern_type", "glob",
            "-i", str(frames_glob),
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", str(crf),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(target),
        ],
        timeout=1800,
    ).check()
    return target


def stack(left: Path, right: Path, target: Path, *, labels: tuple[str, str] | None = None) -> Path:
    """Two angles side by side. The form a demonstration is actually watched in."""
    ffmpeg = require("ffmpeg")
    target.parent.mkdir(parents=True, exist_ok=True)
    if labels:
        filt = (
            f"[0:v]drawtext=text='{labels[0]}':x=16:y=16:fontsize=28:"
            "fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=8[a];"
            f"[1:v]drawtext=text='{labels[1]}':x=16:y=16:fontsize=28:"
            "fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=8[b];"
            "[a][b]hstack=inputs=2"
        )
    else:
        filt = "[0:v][1:v]hstack=inputs=2"
    result = run(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(left), "-i", str(right),
            "-filter_complex", filt,
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(target),
        ],
        timeout=1800,
    )
    if not result.ok and labels:
        # drawtext needs a font config that not every box has; the stack
        # itself is what matters, so fall back to it unlabelled.
        return stack(left, right, target, labels=None)
    result.check()
    return target
