"""When a foot is on the ground.

Both the quality report and the cleanup need this and they must agree: a
report that measures foot slide over one contact interval while the cleanup
locks a different one would grade its own work. So it is decided once, here.

A foot is in contact when it is low and it is slow. Neither test alone
survives real data — a foot is momentarily low at the bottom of a swing and
momentarily slow at the top of one — and the pair of them needs hysteresis,
because a threshold crossed on alternate frames produces a contact that
flickers and a lock that jerks.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import skeleton


@dataclass(frozen=True, slots=True)
class ContactSettings:
    """Thresholds, in metres and metres per second."""

    #: Above this a foot is in the air whatever its speed.
    height: float = 0.06
    #: Below this it is considered stationary and may enter contact.
    enter_speed: float = 0.25
    #: It stays in contact until it exceeds this. Above `enter_speed`, so a
    #: foot cannot chatter between the two on consecutive frames.
    exit_speed: float = 0.45
    #: Contacts shorter than this are noise, not steps.
    min_duration: float = 0.08
    #: Gaps shorter than this inside a contact are closed rather than split.
    max_gap: float = 0.05


@dataclass(frozen=True, slots=True)
class Contacts:
    """Per-foot, per-frame contact, and the intervals it forms."""

    #: {"left": (T,) bool, "right": (T,) bool}
    mask: dict[str, np.ndarray]
    #: {"left": [(start, stop_exclusive), ...], "right": [...]}
    intervals: dict[str, list[tuple[int, int]]]
    #: The ground height each side settled at, in metres.
    ground: dict[str, float]

    @property
    def any_contact(self) -> np.ndarray:
        sides = list(self.mask.values())
        return np.logical_or.reduce(sides) if sides else np.zeros(0, dtype=bool)

    def fraction(self, side: str) -> float:
        mask = self.mask.get(side)
        return float(mask.mean()) if mask is not None and mask.size else 0.0


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True spans as half-open (start, stop) pairs."""
    if mask.size == 0:
        return []
    padded = np.concatenate(([False], mask, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(a), int(b)) for a, b in zip(edges[::2], edges[1::2])]


def _close_gaps(mask: np.ndarray, max_frames: int) -> np.ndarray:
    if max_frames <= 0:
        return mask
    out = mask.copy()
    for start, stop in _runs(~mask):
        # Only interior gaps: a foot that starts or ends the take in the air
        # was not briefly airborne mid-contact.
        if 0 < start and stop < mask.size and (stop - start) <= max_frames:
            out[start:stop] = True
    return out


def _drop_short(mask: np.ndarray, min_frames: int) -> np.ndarray:
    out = mask.copy()
    for start, stop in _runs(mask):
        if (stop - start) < min_frames:
            out[start:stop] = False
    return out


def speeds(joints: np.ndarray, fps: float) -> np.ndarray:
    """Per-joint speed in m/s, central difference. Shape (T, J)."""
    array = np.asarray(joints, dtype=np.float64)
    if array.shape[0] < 2:
        return np.zeros(array.shape[:2])
    velocity = np.gradient(array, 1.0 / fps, axis=0)
    return np.linalg.norm(velocity, axis=-1)


def detect(
    joints: np.ndarray,
    fps: float,
    settings: ContactSettings | None = None,
    *,
    floor: float | None = None,
) -> Contacts:
    """Which frames each foot is planted for.

    `floor` is the ground height; when it is not given it is taken as the 5th
    percentile of foot height over the take, which is robust to a few frames
    of a foot punching through a bad 3D estimate while still following a take
    that was not recovered at exactly y=0.
    """
    config = settings or ContactSettings()
    array = np.asarray(joints, dtype=np.float64)
    frames = array.shape[0]
    speed = speeds(array, fps)

    if floor is None:
        heights = array[:, list(skeleton.FOOT_JOINTS), 1]
        floor = float(np.percentile(heights, 5.0))

    min_frames = max(1, int(round(config.min_duration * fps)))
    gap_frames = int(round(config.max_gap * fps))

    mask: dict[str, np.ndarray] = {}
    intervals: dict[str, list[tuple[int, int]]] = {}
    ground: dict[str, float] = {}

    for side, indices in skeleton.FOOT_SIDES.items():
        # The lowest of the side's joints: a heel planted with the toe raised
        # is still a planted foot.
        height = array[:, list(indices), 1].min(axis=1) - floor
        pace = speed[:, list(indices)].min(axis=1)

        low = height <= config.height
        planted = np.zeros(frames, dtype=bool)
        holding = False
        for frame in range(frames):
            if holding:
                holding = low[frame] and pace[frame] <= config.exit_speed
            else:
                holding = low[frame] and pace[frame] <= config.enter_speed
            planted[frame] = holding

        planted = _close_gaps(planted, gap_frames)
        planted = _drop_short(planted, min_frames)

        mask[side] = planted
        intervals[side] = _runs(planted)
        ground[side] = (
            float(array[planted][:, list(indices), 1].min())
            if planted.any()
            else float(floor)
        )

    return Contacts(mask=mask, intervals=intervals, ground=ground)
