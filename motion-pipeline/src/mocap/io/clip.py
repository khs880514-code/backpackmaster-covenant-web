"""The file every stage hands to the next one.

One container for a take at whatever stage it has reached: 2D keypoints out of
the detector, 3D joints out of the recovery, cleaned joints out of stage 6. It
is an ``.npz`` of arrays with a JSON sidecar, chosen so that a run can be
opened with numpy and a text editor and nothing else — a pipeline you cannot
inspect without running it is a pipeline you cannot debug.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

import numpy as np

from .. import skeleton

CLIP_FORMAT = 1


@dataclass(slots=True)
class Clip:
    """A take, at one stage of the pipeline.

    Only ``fps`` and one of the pose arrays are required; a stage fills in what
    it produces and leaves the rest alone, so the same container survives the
    whole run and carries its own history in ``provenance``.
    """

    fps: float
    #: (T, J, 2) in pixels, or None before stage 2.
    keypoints2d: np.ndarray | None = None
    #: (T, J) in 0..1. Anything unobserved is 0, which is how a stage says
    #: "I did not see this joint" rather than quietly inventing it.
    confidence: np.ndarray | None = None
    #: (T, J, 3) in metres, Y up, Z forward, origin on the floor under the
    #: first frame's pelvis.
    joints3d: np.ndarray | None = None
    #: (T, 3) root translation in metres, when a stage separates it out.
    root_translation: np.ndarray | None = None
    #: (T, J, 3) SMPL axis-angle body pose, when the backend recovers one.
    pose_body: np.ndarray | None = None
    #: (10,) SMPL shape, when the backend recovers one.
    betas: np.ndarray | None = None
    #: (W, H) of the source frames.
    image_size: tuple[int, int] | None = None
    #: What produced this, oldest first. Each entry is one stage's record.
    provenance: list[dict[str, Any]] = field(default_factory=list)

    # -- shape --------------------------------------------------------------

    @property
    def frames(self) -> int:
        for array in (self.joints3d, self.keypoints2d, self.confidence):
            if array is not None:
                return int(array.shape[0])
        return 0

    @property
    def duration(self) -> float:
        return self.frames / self.fps if self.fps > 0 else 0.0

    def validate(self) -> None:
        """Raises unless every array present agrees on frames and joints."""
        if self.fps <= 0:
            raise ValueError(f"fps must be positive, got {self.fps}")
        expected: dict[str, tuple[int, ...]] = {
            "keypoints2d": (skeleton.NUM_JOINTS, 2),
            "confidence": (skeleton.NUM_JOINTS,),
            "joints3d": (skeleton.NUM_JOINTS, 3),
            "root_translation": (3,),
            "pose_body": (skeleton.NUM_JOINTS, 3),
        }
        frames: int | None = None
        for name, tail in expected.items():
            array = getattr(self, name)
            if array is None:
                continue
            if array.shape[1:] != tail:
                raise ValueError(
                    f"{name} should be (T, {', '.join(map(str, tail))}), "
                    f"got {array.shape}"
                )
            if frames is None:
                frames = int(array.shape[0])
            elif array.shape[0] != frames:
                raise ValueError(
                    f"{name} has {array.shape[0]} frames, "
                    f"but an earlier array has {frames}"
                )
        if self.betas is not None and self.betas.shape != (10,):
            raise ValueError(f"betas should be (10,), got {self.betas.shape}")

    def record(self, stage: str, **details: Any) -> "Clip":
        """A copy with one more line of history. Clips are not edited in place
        so a stage can always be re-run against its own input."""
        entry = {"stage": stage, **details}
        return replace(self, provenance=[*self.provenance, entry])

    # -- storage ------------------------------------------------------------

    def save(self, path: str | Path) -> Path:
        self.validate()
        target = Path(path).with_suffix(".npz")
        target.parent.mkdir(parents=True, exist_ok=True)
        arrays = {
            name: value
            for name in (
                "keypoints2d",
                "confidence",
                "joints3d",
                "root_translation",
                "pose_body",
                "betas",
            )
            if (value := getattr(self, name)) is not None
        }
        np.savez_compressed(target, **arrays)
        target.with_suffix(".json").write_text(
            json.dumps(
                {
                    "format": CLIP_FORMAT,
                    "fps": self.fps,
                    "frames": self.frames,
                    "duration": round(self.duration, 4),
                    "joint_names": list(skeleton.JOINT_NAMES),
                    "image_size": list(self.image_size) if self.image_size else None,
                    "arrays": sorted(arrays),
                    "provenance": self.provenance,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return target

    @classmethod
    def load(cls, path: str | Path) -> "Clip":
        source = Path(path).with_suffix(".npz")
        sidecar = source.with_suffix(".json")
        if not source.exists():
            raise FileNotFoundError(f"no clip at {source}")
        if not sidecar.exists():
            raise FileNotFoundError(
                f"{source.name} has no .json beside it; the pair is the clip"
            )
        meta = json.loads(sidecar.read_text(encoding="utf-8"))
        if meta.get("format") != CLIP_FORMAT:
            raise ValueError(
                f"{sidecar.name} is format {meta.get('format')}, "
                f"this build reads {CLIP_FORMAT}"
            )
        with np.load(source) as data:
            arrays = {name: data[name] for name in data.files}
        size = meta.get("image_size")
        clip = cls(
            fps=float(meta["fps"]),
            image_size=(int(size[0]), int(size[1])) if size else None,
            provenance=list(meta.get("provenance", [])),
            **arrays,
        )
        clip.validate()
        return clip
