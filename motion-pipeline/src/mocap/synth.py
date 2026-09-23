"""A reference motion built from joint angles, for testing the pipeline itself.

Nothing here is captured from anybody. It is forward kinematics over a fixed
skeleton, which gives it the one property a test fixture needs and a real
recovery cannot promise: bone lengths that are constant to floating-point
precision. That makes it the control case. When stage 4 reports bone-length
variance on a synthetic take, anything above noise is a bug in stage 4.

It is also where the defects the cleanup stage exists to remove are injected
on purpose — jitter, a sliding contact foot, a drifting root — so stage 6 can
be measured against a known answer instead of an opinion.
"""

from __future__ import annotations

import numpy as np

from . import skeleton
from .io import Clip

#: Segment lengths in metres for a 1.73m figure. Fractions of stature, from
#: the usual anthropometric proportions; the absolute scale only has to be
#: consistent, because stage 5 retargets onto whatever the character is.
STATURE = 1.73
SEGMENTS: dict[str, float] = {
    "pelvis_to_hip": 0.085,
    "thigh": 0.245 * STATURE,
    "shank": 0.246 * STATURE,
    "foot": 0.085 * STATURE,
    "spine": 0.100 * STATURE,
    "neck": 0.052 * STATURE,
    "head": 0.080 * STATURE,
    "collar": 0.090 * STATURE,
    "upper_arm": 0.186 * STATURE,
    "forearm": 0.146 * STATURE,
    "hand": 0.055 * STATURE,
}


def _rot_x(angle: np.ndarray) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    z, o = np.zeros_like(c), np.ones_like(c)
    return np.stack(
        [np.stack([o, z, z], -1), np.stack([z, c, -s], -1), np.stack([z, s, c], -1)], -2
    )


def _rot_y(angle: np.ndarray) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    z, o = np.zeros_like(c), np.ones_like(c)
    return np.stack(
        [np.stack([c, z, s], -1), np.stack([z, o, z], -1), np.stack([-s, z, c], -1)], -2
    )


def _rot_z(angle: np.ndarray) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    z, o = np.zeros_like(c), np.ones_like(c)
    return np.stack(
        [np.stack([c, -s, z], -1), np.stack([s, c, z], -1), np.stack([z, z, o], -1)], -2
    )


def _two_bone(
    hip: np.ndarray,
    ankle: np.ndarray,
    upper: float,
    lower: float,
    *,
    forward: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Where the knee goes so a leg of these two lengths reaches from hip to
    ankle, bending toward `forward`. Returns (knee, ankle).

    The ankle comes back unchanged unless the target is out of reach, in which
    case it is pulled in to the furthest the leg can go — a leg that cannot
    reach should straighten, not stretch.
    """
    to_ankle = ankle - hip
    distance = np.linalg.norm(to_ankle, axis=-1, keepdims=True)
    span = np.clip(distance, abs(upper - lower) + 1e-4, upper + lower - 1e-4)
    direction = to_ankle / np.maximum(distance, 1e-9)
    reached = hip + direction * span

    # Angle at the hip between the thigh and the straight hip-to-ankle line.
    cos_hip = np.clip(
        (upper * upper + span * span - lower * lower) / (2.0 * upper * span), -1.0, 1.0
    )
    angle = np.arccos(cos_hip)

    # A bend plane: `forward` squared up against the leg.
    bend = np.broadcast_to(forward, direction.shape).copy()
    bend = bend - direction * np.sum(bend * direction, axis=-1, keepdims=True)
    length = np.linalg.norm(bend, axis=-1, keepdims=True)
    fallback = np.array([0.0, 0.0, 1.0])
    bend = np.where(length > 1e-6, bend / np.maximum(length, 1e-9), fallback)

    knee = hip + upper * (np.cos(angle) * direction + np.sin(angle) * bend)
    return knee, reached


def _ease(t: np.ndarray) -> np.ndarray:
    """Smoothstep. A limb that starts and stops abruptly reads as a glitch,
    and would put a spike in the jitter metric that is not a capture problem."""
    x = np.clip(t, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _swing(t: np.ndarray, start: float, peak: float, end: float, amount: float) -> np.ndarray:
    """One limb action: rise to `amount` by `peak`, return by `end`."""
    up = _ease((t - start) / max(1e-6, peak - start))
    down = 1.0 - _ease((t - peak) / max(1e-6, end - start if end > peak else 1e-6))
    return amount * np.where(t < peak, up, np.clip(down, 0.0, 1.0))


def _build(
    amplitude: float,
    frames: int,
    contact: float,
    side: str,
) -> np.ndarray:
    """One pass of the kick at a given hip amplitude, as (T, 24, 3) metres."""
    t = np.linspace(0.0, 1.0, frames)
    kick = 1 if side == "right" else -1
    hip_height = SEGMENTS["thigh"] + SEGMENTS["shank"] + SEGMENTS["pelvis_to_hip"]

    lift = amplitude

    chamber = _swing(t, 0.10, contact - 0.10, contact + 0.28, lift)
    extend = _swing(t, contact - 0.14, contact, contact + 0.22, 1.0)
    # The knee is folded on the way up and snaps open into the contact; that
    # ordering is the whole shape of a kick and the thing a retarget must keep.
    knee_fold = np.clip(chamber / max(lift, 1e-6) * 1.9 - extend * 1.75, 0.0, 2.1)

    # The body answers the leg: a lean back, a small squat, a guard.
    lean = -_swing(t, 0.05, contact, contact + 0.35, 0.22)
    squat = -_swing(t, 0.0, contact - 0.2, contact + 0.4, 0.09)
    twist = _swing(t, 0.05, contact, contact + 0.3, 0.18) * kick
    guard = _swing(t, 0.0, 0.3, 1.2, 0.9)

    joints = np.zeros((frames, skeleton.NUM_JOINTS, 3))
    J = skeleton.INDEX

    # Pelvis: planted foot decides its height, so the leg never has to stretch.
    pelvis = np.zeros((frames, 3))
    pelvis[:, 1] = hip_height + squat * SEGMENTS["thigh"]
    pelvis[:, 2] = squat * 0.12
    root = _rot_y(twist) @ _rot_x(lean)

    def place(index: int, parent: int, offset: np.ndarray, rot: np.ndarray) -> np.ndarray:
        joints[:, index] = joints[:, parent] + np.einsum("tij,j->ti", rot, offset)
        return rot

    joints[:, J["pelvis"]] = pelvis

    for name, sign in (("left", -1), ("right", 1)):
        hip_i = J[f"{name}_hip"]
        joints[:, hip_i] = pelvis + np.einsum(
            "tij,j->ti", root, np.array([sign * SEGMENTS["pelvis_to_hip"], -0.02, 0.0])
        )

        if sign == kick:
            # The kicking leg is driven by its angles: that is the motion.
            thigh_rot = root @ _rot_x(-chamber)
            place(J[f"{name}_knee"], hip_i, np.array([0.0, -SEGMENTS["thigh"], 0.0]), thigh_rot)
            shank_rot = thigh_rot @ _rot_x(knee_fold)
            place(
                J[f"{name}_ankle"], J[f"{name}_knee"],
                np.array([0.0, -SEGMENTS["shank"], 0.0]), shank_rot,
            )
            toe_rot = shank_rot @ _rot_x(np.full(frames, -1.3) + extend * 0.7)
            place(
                J[f"{name}_foot"], J[f"{name}_ankle"],
                np.array([0.0, -SEGMENTS["foot"], 0.0]), toe_rot,
            )
        else:
            # The support leg is driven by its foot: it stays where it was put
            # and the knee bends to allow whatever the pelvis does. Angling it
            # instead lets the hips drag the foot around, which is the very
            # artefact stage 6 exists to remove — a fixture that contains it
            # cannot be used to test for it.
            stance = joints[0, hip_i] + np.array([0.0, -(SEGMENTS["thigh"] + SEGMENTS["shank"]) * 0.995, 0.02])
            knee, ankle = _two_bone(
                joints[:, hip_i], np.broadcast_to(stance, (frames, 3)),
                SEGMENTS["thigh"], SEGMENTS["shank"], forward=np.array([0.0, 0.0, 1.0]),
            )
            joints[:, J[f"{name}_knee"]] = knee
            joints[:, J[f"{name}_ankle"]] = ankle
            # Flat on the floor, toes forward, however the shank is angled.
            joints[:, J[f"{name}_foot"]] = ankle + np.array(
                [0.0, -SEGMENTS["foot"] * 0.35, SEGMENTS["foot"] * 0.94]
            )

    spine1 = place(J["spine1"], J["pelvis"], np.array([0.0, SEGMENTS["spine"] * 0.45, 0.0]), root)
    spine2_rot = root @ _rot_x(lean * 0.4)
    place(J["spine2"], J["spine1"], np.array([0.0, SEGMENTS["spine"] * 0.55, 0.0]), spine2_rot)
    chest = spine2_rot @ _rot_x(lean * 0.3)
    place(J["spine3"], J["spine2"], np.array([0.0, SEGMENTS["spine"] * 0.6, 0.0]), chest)
    place(J["neck"], J["spine3"], np.array([0.0, SEGMENTS["neck"], 0.0]), chest)
    head_rot = chest @ _rot_x(-lean * 0.8)
    place(J["head"], J["neck"], np.array([0.0, SEGMENTS["head"], 0.0]), head_rot)

    for name, sign in (("left", -1), ("right", 1)):
        collar_i = J[f"{name}_collar"]
        place(collar_i, J["spine3"], np.array([sign * SEGMENTS["collar"] * 0.4, 0.02, 0.0]), chest)
        shoulder_i = J[f"{name}_shoulder"]
        place(shoulder_i, collar_i, np.array([sign * SEGMENTS["collar"] * 0.6, 0.0, 0.0]), chest)
        # Arms fold to a guard: down at rest, up and across as the kick goes.
        arm_rot = chest @ _rot_z(np.full(frames, sign * -0.15)) @ _rot_x(-guard * 1.25)
        place(J[f"{name}_elbow"], shoulder_i, np.array([0.0, -SEGMENTS["upper_arm"], 0.0]), arm_rot)
        fore_rot = arm_rot @ _rot_x(-guard * 1.3)
        place(J[f"{name}_wrist"], J[f"{name}_elbow"], np.array([0.0, -SEGMENTS["forearm"], 0.0]), fore_rot)
        place(J[f"{name}_hand"], J[f"{name}_wrist"], np.array([0.0, -SEGMENTS["hand"], 0.0]), fore_rot)

    # Put the planted foot on the floor, where the rest of the pipeline
    # expects it. The support foot defines the ground, not the lowest
    # point of the whole figure: a kicking toe passing below it is a
    # rendering question, not a change of floor.
    support = J[("left" if kick == 1 else "right") + "_foot"]
    joints[:, :, 1] -= joints[:, support, 1].mean()
    return joints


def front_kick(
    frames: int = 90,
    fps: float = 30.0,
    *,
    contact: float = 0.55,
    target_height: float = 0.86,
    side: str = "right",
) -> np.ndarray:
    """A front kick whose ankle reaches `target_height`, as (T, 24, 3) metres.

    The support foot is planted for the whole take and the pelvis rises and
    settles, which is what gives stage 6 a real contact interval to lock and a
    real vertical excursion it must not flatten.

    The hip amplitude that produces a given height depends on how the knee
    extension and the lean overlap, so it is solved for rather than derived:
    the height is the number a demonstration is specified in, and a fixture
    whose parameter is off by 9cm is not one you can aim.
    """
    reach = SEGMENTS["thigh"] + SEGMENTS["shank"]
    ankle = skeleton.INDEX[f"{side}_ankle"]

    low, high = 0.0, np.pi * 0.95
    joints = _build(high, frames, contact, side)
    if joints[:, ankle, 1].max() < target_height:
        # Beyond what this leg can lift; the fixture goes as high as it goes.
        return joints

    for _ in range(24):
        mid = 0.5 * (low + high)
        joints = _build(mid, frames, contact, side)
        if joints[:, ankle, 1].max() < target_height:
            low = mid
        else:
            high = mid
        if high - low < 1e-4:
            break
    return _build(0.5 * (low + high), frames, contact, side)


def degrade(
    joints: np.ndarray,
    *,
    jitter: float = 0.004,
    drift: float = 0.06,
    foot_slide: float = 0.02,
    seed: int = 7,
) -> np.ndarray:
    """Adds the three defects stage 6 exists to remove, at known amounts.

    This is how the cleanup is tested: degrade a clean take by a measured
    amount, clean it, and check the measurement comes back. Without it, "the
    foot lock looks better" is the only available verdict.
    """
    rng = np.random.default_rng(seed)
    out = np.array(joints, dtype=np.float64, copy=True)
    frames = out.shape[0]

    if jitter > 0:
        out += rng.normal(0.0, jitter, size=out.shape)
    if drift > 0:
        ramp = np.linspace(0.0, 1.0, frames)[:, None]
        # A slow curve, not a straight line: a straight line is too easy to fit.
        walk = np.stack([ramp[:, 0] ** 1.5, np.zeros(frames), ramp[:, 0] * 0.6], -1)
        out += (walk * drift)[:, None, :]
    if foot_slide > 0:
        creep = np.linspace(0.0, foot_slide, frames)
        for index in skeleton.FOOT_JOINTS:
            out[:, index, 0] += creep
    return out


def clip(
    frames: int = 90,
    fps: float = 30.0,
    *,
    degraded: bool = False,
    **kwargs: object,
) -> Clip:
    """A synthetic take as a `Clip`, ready for any stage from 4 onward."""
    joints = front_kick(frames=frames, fps=fps, **kwargs)  # type: ignore[arg-type]
    if degraded:
        joints = degrade(joints)
    take = Clip(
        fps=fps,
        joints3d=joints,
        confidence=np.ones((frames, skeleton.NUM_JOINTS)),
    )
    return take.record(
        "synth",
        motion="front_kick",
        degraded=bool(degraded),
        note="generated, not captured from anyone",
    )
