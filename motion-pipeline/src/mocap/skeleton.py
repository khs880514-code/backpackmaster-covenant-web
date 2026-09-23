"""The one joint set every stage speaks.

Each stage of this pipeline is replaceable — a different 2D detector, a
different 3D recovery, a different character to retarget onto — and the only
thing that keeps them interchangeable is agreeing on what a pose *is*. That
agreement lives here and nowhere else.

The set is SMPL's 24 joints in SMPL's order. Not because SMPL is the only
option, but because stage 3 recovers SMPL bodies and every other convention in
the field publishes a mapping to it, so adopting anything else would mean
converting twice.
"""

from __future__ import annotations

from typing import Final

#: SMPL's 24 body joints, in SMPL's index order. Index is meaningful.
JOINT_NAMES: Final[tuple[str, ...]] = (
    "pelvis",
    "left_hip",
    "right_hip",
    "spine1",
    "left_knee",
    "right_knee",
    "spine2",
    "left_ankle",
    "right_ankle",
    "spine3",
    "left_foot",
    "right_foot",
    "neck",
    "left_collar",
    "right_collar",
    "head",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hand",
    "right_hand",
)

NUM_JOINTS: Final[int] = len(JOINT_NAMES)

#: Parent of each joint, by index. The pelvis is the root and has none.
PARENTS: Final[tuple[int, ...]] = (
    -1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19, 20, 21,
)

INDEX: Final[dict[str, int]] = {name: i for i, name in enumerate(JOINT_NAMES)}

#: Every parent-child pair, as (parent, child) indices. What a "bone" means
#: for the length-consistency metric and for drawing a stick figure.
BONES: Final[tuple[tuple[int, int], ...]] = tuple(
    (parent, child) for child, parent in enumerate(PARENTS) if parent >= 0
)

#: The joints that carry weight. Foot contact, ground penetration and foot
#: slide are all measured on these and nothing else.
FOOT_JOINTS: Final[tuple[int, ...]] = (
    INDEX["left_ankle"],
    INDEX["right_ankle"],
    INDEX["left_foot"],
    INDEX["right_foot"],
)

#: Which foot each of those belongs to, for per-side contact detection.
FOOT_SIDES: Final[dict[str, tuple[int, ...]]] = {
    "left": (INDEX["left_ankle"], INDEX["left_foot"]),
    "right": (INDEX["right_ankle"], INDEX["right_foot"]),
}

#: Joints whose left/right counterpart exists, for mirroring a take.
MIRROR: Final[tuple[int, ...]] = tuple(
    INDEX[
        name.replace("left_", "right_")
        if name.startswith("left_")
        else name.replace("right_", "left_")
        if name.startswith("right_")
        else name
    ]
    for name in JOINT_NAMES
)


def bone_lengths(joints: "object") -> "object":
    """Length of every bone, per frame. Shape (T, len(BONES)).

    A rigid skeleton holds these constant. How much they vary is the single
    most useful number for telling a good 3D recovery from a bad one, because
    nothing else in the pipeline is allowed to change them.
    """
    import numpy as np

    array = np.asarray(joints, dtype=np.float64)
    if array.ndim != 3 or array.shape[1] != NUM_JOINTS or array.shape[2] != 3:
        raise ValueError(
            f"expected joints of shape (T, {NUM_JOINTS}, 3), got {array.shape}"
        )
    parent = array[:, [b[0] for b in BONES], :]
    child = array[:, [b[1] for b in BONES], :]
    return np.linalg.norm(child - parent, axis=-1)


#: MediaPipe Pose's 33 landmarks, by the index MediaPipe gives them.
MEDIAPIPE_LANDMARKS: Final[dict[str, int]] = {
    "nose": 0,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_index": 19,
    "right_index": 20,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_foot_index": 31,
    "right_foot_index": 32,
}

#: Direct landmark -> joint correspondences. Everything else in the joint set
#: is derived (see `mocap.backends.pose2d.mediapipe`) or left unobserved,
#: which is what the confidence array is for.
MEDIAPIPE_TO_JOINT: Final[dict[int, int]] = {
    MEDIAPIPE_LANDMARKS["left_hip"]: INDEX["left_hip"],
    MEDIAPIPE_LANDMARKS["right_hip"]: INDEX["right_hip"],
    MEDIAPIPE_LANDMARKS["left_knee"]: INDEX["left_knee"],
    MEDIAPIPE_LANDMARKS["right_knee"]: INDEX["right_knee"],
    MEDIAPIPE_LANDMARKS["left_ankle"]: INDEX["left_ankle"],
    MEDIAPIPE_LANDMARKS["right_ankle"]: INDEX["right_ankle"],
    MEDIAPIPE_LANDMARKS["left_foot_index"]: INDEX["left_foot"],
    MEDIAPIPE_LANDMARKS["right_foot_index"]: INDEX["right_foot"],
    MEDIAPIPE_LANDMARKS["left_shoulder"]: INDEX["left_shoulder"],
    MEDIAPIPE_LANDMARKS["right_shoulder"]: INDEX["right_shoulder"],
    MEDIAPIPE_LANDMARKS["left_elbow"]: INDEX["left_elbow"],
    MEDIAPIPE_LANDMARKS["right_elbow"]: INDEX["right_elbow"],
    MEDIAPIPE_LANDMARKS["left_wrist"]: INDEX["left_wrist"],
    MEDIAPIPE_LANDMARKS["right_wrist"]: INDEX["right_wrist"],
    MEDIAPIPE_LANDMARKS["left_index"]: INDEX["left_hand"],
    MEDIAPIPE_LANDMARKS["right_index"]: INDEX["right_hand"],
    MEDIAPIPE_LANDMARKS["nose"]: INDEX["head"],
}
