"""Backends for stage 2: video in, 2D keypoints out."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from .. import skeleton
from ..io import Clip
from .registry import Availability, Backend, register


class Pose2DBackend:
    name = "base"

    def detect(self, video: Path, *, fps: float, every: int = 1) -> Clip:
        raise NotImplementedError


# -- MediaPipe ---------------------------------------------------------------


class MediaPipeBackend(Pose2DBackend):
    """Google's Pose Landmarker. CPU-only, fast, and good enough for a single
    clearly framed subject, which is what a demonstration take is."""

    name = "mediapipe"

    def __init__(self, complexity: int = 2, min_confidence: float = 0.5) -> None:
        self.complexity = complexity
        self.min_confidence = min_confidence

    def detect(self, video: Path, *, fps: float, every: int = 1) -> Clip:
        import cv2  # noqa: PLC0415 - optional dependency, imported on use
        import mediapipe as mp  # noqa: PLC0415

        capture = cv2.VideoCapture(str(video))
        if not capture.isOpened():
            raise RuntimeError(f"could not open {video}")
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

        keypoints: list[np.ndarray] = []
        confidence: list[np.ndarray] = []

        with mp.solutions.pose.Pose(
            static_image_mode=False,
            model_complexity=self.complexity,
            min_detection_confidence=self.min_confidence,
            min_tracking_confidence=self.min_confidence,
        ) as pose:
            index = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if index % every == 0:
                    result = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    points, scores = self._convert(result, width, height)
                    keypoints.append(points)
                    confidence.append(scores)
                index += 1
        capture.release()

        if not keypoints:
            raise RuntimeError(f"no frames read from {video}")

        return Clip(
            fps=fps / every,
            keypoints2d=np.stack(keypoints),
            confidence=np.stack(confidence),
            image_size=(width, height),
        ).record("pose2d", backend=self.name, complexity=self.complexity)

    @staticmethod
    def _convert(result: object, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
        points = np.zeros((skeleton.NUM_JOINTS, 2))
        scores = np.zeros(skeleton.NUM_JOINTS)
        landmarks = getattr(result, "pose_landmarks", None)
        if landmarks is None:
            return points, scores

        raw = landmarks.landmark
        for landmark_index, joint_index in skeleton.MEDIAPIPE_TO_JOINT.items():
            mark = raw[landmark_index]
            points[joint_index] = (mark.x * width, mark.y * height)
            scores[joint_index] = float(getattr(mark, "visibility", 1.0))

        # MediaPipe has no spine. The joints between the hips and the neck are
        # interpolated from the two it does have, and marked with the lower of
        # their confidences so stage 3 knows they were inferred, not seen.
        J = skeleton.INDEX
        hips = (points[J["left_hip"]] + points[J["right_hip"]]) / 2.0
        shoulders = (points[J["left_shoulder"]] + points[J["right_shoulder"]]) / 2.0
        trunk = min(
            scores[J["left_hip"]], scores[J["right_hip"]],
            scores[J["left_shoulder"]], scores[J["right_shoulder"]],
        )
        for name, alpha in (
            ("pelvis", 0.0), ("spine1", 0.25), ("spine2", 0.5),
            ("spine3", 0.75), ("neck", 1.0),
        ):
            points[J[name]] = hips + (shoulders - hips) * alpha
            scores[J[name]] = trunk
        for side in ("left", "right"):
            points[J[f"{side}_collar"]] = (shoulders + points[J[f"{side}_shoulder"]]) / 2.0
            scores[J[f"{side}_collar"]] = min(trunk, scores[J[f"{side}_shoulder"]])
        return points, scores


# -- OpenPose (import) -------------------------------------------------------


class OpenPoseJsonBackend(Pose2DBackend):
    """Reads a directory of OpenPose ``*_keypoints.json`` files.

    For footage already processed elsewhere — a studio with a rig, or a take
    run on a machine with a GPU. Nothing is detected here; it is a reader.
    """

    name = "openpose_json"
    #: BODY_25 index -> our joint index.
    BODY25 = {
        8: "pelvis", 1: "neck", 0: "head",
        9: "right_hip", 10: "right_knee", 11: "right_ankle", 22: "right_foot",
        12: "left_hip", 13: "left_knee", 14: "left_ankle", 19: "left_foot",
        2: "right_shoulder", 3: "right_elbow", 4: "right_wrist",
        5: "left_shoulder", 6: "left_elbow", 7: "left_wrist",
    }

    def __init__(self, directory: Path | None = None) -> None:
        self.directory = directory

    def detect(self, video: Path, *, fps: float, every: int = 1) -> Clip:
        import json  # noqa: PLC0415

        source = self.directory or video.parent / "openpose"
        files = sorted(Path(source).glob("*_keypoints.json"))
        if not files:
            raise FileNotFoundError(
                f"no *_keypoints.json under {source}. Point "
                "pose2d.openpose_json.directory at OpenPose's --write_json output"
            )

        keypoints, confidence = [], []
        for path in files:
            payload = json.loads(path.read_text(encoding="utf-8"))
            people = payload.get("people") or []
            points = np.zeros((skeleton.NUM_JOINTS, 2))
            scores = np.zeros(skeleton.NUM_JOINTS)
            if people:
                # The largest detection: a demonstration has one subject, and
                # whoever is holding the camera is not it.
                best = max(people, key=lambda p: _spread(p.get("pose_keypoints_2d", [])))
                flat = best.get("pose_keypoints_2d", [])
                for body_index, joint_name in self.BODY25.items():
                    base = body_index * 3
                    if base + 2 < len(flat):
                        joint = skeleton.INDEX[joint_name]
                        points[joint] = (flat[base], flat[base + 1])
                        scores[joint] = flat[base + 2]
            keypoints.append(points)
            confidence.append(scores)

        return Clip(
            fps=fps,
            keypoints2d=np.stack(keypoints),
            confidence=np.stack(confidence),
        ).record("pose2d", backend=self.name, files=len(files))


def _spread(flat: list[float]) -> float:
    if not flat:
        return 0.0
    xs = np.array(flat[0::3])
    ys = np.array(flat[1::3])
    cs = np.array(flat[2::3])
    seen = cs > 0.1
    if seen.sum() < 4:
        return 0.0
    return float((xs[seen].ptp()) * (ys[seen].ptp()))


# -- Synthetic ---------------------------------------------------------------


class SyntheticBackend(Pose2DBackend):
    """Projects the built-in reference motion to 2D. No video is read.

    This is what makes the pipeline testable on a machine with no detector
    installed: every stage downstream sees arrays of the right shape with
    plausible content, so a change to stage 6 or stage 9 can be exercised
    without a GPU or a subject.
    """

    name = "synthetic"

    def __init__(self, frames: int = 90, target_height: float = 0.86, noise: float = 2.0) -> None:
        self.frames = frames
        self.target_height = target_height
        self.noise = noise

    def detect(self, video: Path, *, fps: float, every: int = 1) -> Clip:
        from .. import synth  # noqa: PLC0415

        joints = synth.front_kick(self.frames, fps, target_height=self.target_height)
        width, height = 1080, 1920
        # A plain side-on pinhole: X across the frame, Y down it.
        scale = height * 0.42
        centre = np.array([width / 2.0, height * 0.82])
        points = np.stack(
            [
                centre[0] + joints[:, :, 0] * scale,
                centre[1] - joints[:, :, 1] * scale,
            ],
            axis=-1,
        )
        rng = np.random.default_rng(11)
        points += rng.normal(0.0, self.noise, points.shape)
        return Clip(
            fps=fps,
            keypoints2d=points,
            confidence=np.full((self.frames, skeleton.NUM_JOINTS), 0.97),
            image_size=(width, height),
        ).record("pose2d", backend=self.name, note="projected fixture, no video read")


register(Backend(
    kind="pose2d", name="mediapipe",
    summary="MediaPipe Pose (CPU, single subject)",
    check=lambda: _both("mediapipe", "cv2", "pip install mediapipe opencv-python-headless"),
    load=lambda: MediaPipeBackend(),
))
register(Backend(
    kind="pose2d", name="openpose_json",
    summary="read OpenPose --write_json output",
    check=lambda: Availability(True, "reads files; nothing to install"),
    load=lambda: OpenPoseJsonBackend(),
    builtin=True,
))
register(Backend(
    kind="pose2d", name="synthetic",
    summary="projected reference motion, for testing the pipeline itself",
    check=lambda: Availability(True, "built in"),
    load=lambda: SyntheticBackend(),
    builtin=True,
))


def _both(first: str, second: str, hint: str) -> Availability:
    import importlib.util

    missing = [m for m in (first, second) if importlib.util.find_spec(m) is None]
    if missing:
        return Availability(False, f"missing {', '.join(missing)} — {hint}")
    return Availability(True, f"{first} + {second} present")
