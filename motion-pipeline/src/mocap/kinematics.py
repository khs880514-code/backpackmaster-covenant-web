"""Skeleton maths shared by the fixture, the cleanup and the Blender export."""

from __future__ import annotations

import numpy as np

from . import skeleton


def two_bone(
    hip: np.ndarray,
    ankle: np.ndarray,
    upper: float,
    lower: float,
    *,
    forward: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Where the knee goes so a leg of these lengths reaches hip to ankle.

    Returns (knee, ankle). The ankle comes back unchanged unless the target is
    out of reach, in which case it is pulled in to the furthest the leg can
    go — a leg that cannot reach should straighten, not stretch.
    """
    to_ankle = np.atleast_2d(ankle) - np.atleast_2d(hip)
    distance = np.linalg.norm(to_ankle, axis=-1, keepdims=True)
    span = np.clip(distance, abs(upper - lower) + 1e-4, upper + lower - 1e-4)
    direction = to_ankle / np.maximum(distance, 1e-9)
    reached = np.atleast_2d(hip) + direction * span

    cos_hip = np.clip(
        (upper * upper + span * span - lower * lower) / (2.0 * upper * span), -1.0, 1.0
    )
    angle = np.arccos(cos_hip)

    bend = np.broadcast_to(forward, direction.shape).astype(np.float64).copy()
    bend -= direction * np.sum(bend * direction, axis=-1, keepdims=True)
    length = np.linalg.norm(bend, axis=-1, keepdims=True)
    bend = np.where(length > 1e-6, bend / np.maximum(length, 1e-9), np.array([0.0, 0.0, 1.0]))

    knee = np.atleast_2d(hip) + upper * (np.cos(angle) * direction + np.sin(angle) * bend)
    return knee, reached


def rest_lengths(joints: np.ndarray) -> np.ndarray:
    """The length each bone should be: its median over the take.

    Median rather than mean, because a handful of frames where the recovery
    guessed depth badly should not decide the skeleton everything else is
    rebuilt onto.
    """
    return np.median(skeleton.bone_lengths(joints), axis=0)


def rigidify(joints: np.ndarray, lengths: np.ndarray | None = None) -> np.ndarray:
    """Rebuilds every frame onto one fixed skeleton, keeping bone directions.

    Walks out from the pelvis and re-places each child at its parent plus the
    direction it had, scaled to the length it should be. Direction is what the
    recovery is confident about; length is what it is not.
    """
    array = np.asarray(joints, dtype=np.float64)
    target = rest_lengths(array) if lengths is None else np.asarray(lengths, float)
    out = array.copy()

    # Parents before children, which the SMPL ordering already guarantees, but
    # sorting by depth keeps this correct if that ever changes.
    depth = np.zeros(skeleton.NUM_JOINTS, dtype=int)
    for index, parent in enumerate(skeleton.PARENTS):
        if parent >= 0:
            depth[index] = depth[parent] + 1

    for bone_index, (parent, child) in sorted(
        enumerate(skeleton.BONES), key=lambda pair: depth[pair[1][1]]
    ):
        direction = array[:, child] - array[:, parent]
        norm = np.linalg.norm(direction, axis=-1, keepdims=True)
        unit = np.divide(direction, norm, out=np.zeros_like(direction), where=norm > 1e-9)
        out[:, child] = out[:, parent] + unit * target[bone_index]
    return out


def savgol(values: np.ndarray, window: int, order: int = 2) -> np.ndarray:
    """Savitzky-Golay along axis 0, edges handled by reflection.

    A polynomial fit rather than a moving average, because a kick is mostly
    peak and an average takes the top off it — which is exactly the part a
    demonstration is made to show.
    """
    array = np.asarray(values, dtype=np.float64)
    length = array.shape[0]
    if length < 3 or window < 3:
        return array.copy()
    window = min(window if window % 2 == 1 else window + 1, length if length % 2 == 1 else length - 1)
    if window < 3 or order >= window:
        return array.copy()

    half = window // 2
    # Least-squares polynomial smoothing coefficients for the centre point.
    steps = np.arange(-half, half + 1, dtype=np.float64)
    design = np.vander(steps, order + 1, increasing=True)
    coefficients = np.linalg.pinv(design)[0]

    padded = np.concatenate(
        [array[1 : half + 1][::-1] * 2 - array[0], array, array[-half - 1 : -1][::-1] * 2 - array[-1]],
        axis=0,
    )
    flat = padded.reshape(padded.shape[0], -1)
    out = np.empty((length, flat.shape[1]))
    for column in range(flat.shape[1]):
        out[:, column] = np.convolve(flat[:, column], coefficients[::-1], mode="valid")
    return out.reshape(array.shape)
