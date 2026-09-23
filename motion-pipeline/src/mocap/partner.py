"""The other person in the frame, in whichever position the drill is taught from.

A demonstration is two people. The one performing the technique comes from a
captured take; the one receiving it is a static pose, because what matters
about them is the geometry — how high the target is, which way they face, what
the demonstrator has to reach past. Generating those poses from joint angles
rather than shipping five rigged assets keeps a preset a text file that can be
adjusted in an afternoon.

The poses are deliberately plain: a legible body in a known position, at a
stated height, facing a stated way. Nothing here is a character.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import skeleton
from .synth import SEGMENTS, _rot_x, _rot_y, _rot_z


@dataclass(frozen=True, slots=True)
class PartnerPose:
    """One static pose, plus what a demonstration needs to know about it."""

    name: str
    joints: np.ndarray
    #: Height of the contact region above the floor, in metres. What a camera
    #: frames on and what a preset is really specifying.
    target_height: float
    #: Degrees about the vertical: 0 faces the demonstrator, 180 faces away.
    facing: float
    description: str = ""

    @property
    def stature(self) -> float:
        head = float(self.joints[skeleton.INDEX["head"], 1])
        return head * 1.13


#: Joint angles per preset, in radians, applied to a standing rest pose.
#: hip/knee are per side; `lean` folds the whole torso forward.
POSTURES: dict[str, dict[str, float]] = {
    "standing": {"hip": 0.05, "knee": 0.08, "lean": 0.04, "arm": 0.25, "height": 0.86},
    "kneeling": {"hip": 1.55, "knee": 2.45, "lean": 0.10, "arm": 0.35, "height": 0.54},
    "turned_away": {"hip": 0.05, "knee": 0.10, "lean": 0.06, "arm": 0.20, "height": 0.84},
    "prone": {"hip": 1.50, "knee": 0.25, "lean": 1.48, "arm": 1.30, "height": 0.26},
    "seated": {"hip": 1.52, "knee": 1.52, "lean": 0.12, "arm": 0.30, "height": 0.62},
}

FACING: dict[str, float] = {
    "standing": 0.0,
    "kneeling": 0.0,
    "turned_away": 180.0,
    "prone": 180.0,
    "seated": 0.0,
}

DESCRIPTIONS: dict[str, str] = {
    "standing": "upright and square on",
    "kneeling": "on both knees, upright from the hips",
    "turned_away": "upright, back to the demonstrator",
    "prone": "face down, hips toward the demonstrator",
    "seated": "seated, thighs level, back upright",
}


def build(name: str, *, stature: float = 1.75) -> PartnerPose:
    """A static partner in the named posture, standing on the floor at origin."""
    if name not in POSTURES:
        raise KeyError(f"no partner posture '{name}'. Known: {', '.join(sorted(POSTURES))}")
    angles = POSTURES[name]
    scale = stature / 1.73
    seg = {key: value * scale for key, value in SEGMENTS.items()}
    seg["pelvis_to_hip"] = SEGMENTS["pelvis_to_hip"] * scale

    joints = np.zeros((skeleton.NUM_JOINTS, 3))
    J = skeleton.INDEX
    one = np.zeros(1)

    def rot(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> np.ndarray:
        return (_rot_y(one + y) @ _rot_x(one + x) @ _rot_z(one + z))[0]

    lean = angles["lean"]
    hip_a = angles["hip"]
    knee_a = angles["knee"]

    # Hips sit where a leg folded by `hip`/`knee` puts them.
    thigh_drop = seg["thigh"] * np.cos(hip_a)
    shank_drop = seg["shank"] * np.cos(max(0.0, hip_a - knee_a))
    pelvis_y = max(0.12 * scale, thigh_drop + shank_drop + seg["pelvis_to_hip"] * 0.5)
    joints[J["pelvis"]] = (0.0, pelvis_y, 0.0)

    root = rot(x=lean)
    for side, sign in (("left", -1), ("right", 1)):
        hip_i = J[f"{side}_hip"]
        joints[hip_i] = joints[J["pelvis"]] + np.array([sign * seg["pelvis_to_hip"], -0.02, 0.0])
        thigh = rot(x=-hip_a)
        joints[J[f"{side}_knee"]] = joints[hip_i] + thigh @ np.array([0.0, -seg["thigh"], 0.0])
        shank = rot(x=-hip_a + knee_a)
        joints[J[f"{side}_ankle"]] = joints[J[f"{side}_knee"]] + shank @ np.array(
            [0.0, -seg["shank"], 0.0]
        )
        joints[J[f"{side}_foot"]] = joints[J[f"{side}_ankle"]] + np.array(
            [0.0, -seg["foot"] * 0.3, seg["foot"] * 0.9]
        )

    chain = [
        ("spine1", "pelvis", seg["spine"] * 0.45),
        ("spine2", "spine1", seg["spine"] * 0.55),
        ("spine3", "spine2", seg["spine"] * 0.6),
        ("neck", "spine3", seg["neck"]),
        ("head", "neck", seg["head"]),
    ]
    for child, parent, length in chain:
        joints[J[child]] = joints[J[parent]] + root @ np.array([0.0, length, 0.0])

    for side, sign in (("left", -1), ("right", 1)):
        joints[J[f"{side}_collar"]] = joints[J["spine3"]] + root @ np.array(
            [sign * seg["collar"] * 0.4, 0.02, 0.0]
        )
        joints[J[f"{side}_shoulder"]] = joints[J[f"{side}_collar"]] + root @ np.array(
            [sign * seg["collar"] * 0.6, 0.0, 0.0]
        )
        arm = rot(x=lean - angles["arm"], z=sign * -0.12)
        joints[J[f"{side}_elbow"]] = joints[J[f"{side}_shoulder"]] + arm @ np.array(
            [0.0, -seg["upper_arm"], 0.0]
        )
        fore = rot(x=lean - angles["arm"] * 1.6, z=sign * -0.12)
        joints[J[f"{side}_wrist"]] = joints[J[f"{side}_elbow"]] + fore @ np.array(
            [0.0, -seg["forearm"], 0.0]
        )
        joints[J[f"{side}_hand"]] = joints[J[f"{side}_wrist"]] + fore @ np.array(
            [0.0, -seg["hand"], 0.0]
        )

    # On the floor, whatever the posture worked out to.
    joints[:, 1] -= joints[:, 1].min()

    return PartnerPose(
        name=name,
        joints=joints,
        target_height=float(angles["height"] * scale),
        facing=FACING.get(name, 0.0),
        description=DESCRIPTIONS.get(name, ""),
    )


def names() -> list[str]:
    return sorted(POSTURES)
