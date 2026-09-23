"""Stage 6: making a recovered motion sit still where it is supposed to.

Five passes, in an order that matters. Each one assumes the previous has
already happened, and running them the other way round undoes work:

1. **Rigidify.** One skeleton for the whole take. Most of what reads as
   jitter is the recovery changing its mind about depth, which changes bone
   lengths; fix that and there is much less left to filter.
2. **Smooth.** What remains, taken out with a polynomial filter rather than an
   average, because a kick is mostly peak.
3. **Drift.** The whole figure sliding across the floor over the take. Removed
   against the planted feet, so a step survives and a slide does not.
4. **Pelvis.** The root wobbling inside an otherwise good body. Filtered
   harder than the limbs, since hips do not change direction every frame.
5. **Foot lock.** Last, so it is the final word: whatever the passes above
   left, a foot on the ground stays where it was put.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import skeleton
from .contact import ContactSettings, Contacts, detect
from .kinematics import rigidify, savgol, two_bone


@dataclass(frozen=True, slots=True)
class CleanupSettings:
    rigidify: bool = True
    #: Smoothing window in seconds.
    #:
    #: Measured on a fixture degraded by a known amount, at 30fps: a 0.10s
    #: window is three frames and leaves jitter at 18mm, worse than the input,
    #: because rigidifying noisy directions propagates their error down the
    #: chain. 0.17s halves it, 0.23s quarters it. Past that the gain is small
    #: and the risk to the peak is not, so this sits at 0.23s.
    smooth_seconds: float = 0.23
    smooth_order: int = 2
    #: Extra smoothing for the pelvis alone, in seconds. Zero disables it.
    pelvis_seconds: float = 0.25
    #: How much of the pelvis filtering to actually apply, 0..1.
    pelvis_strength: float = 0.7
    #: "none" keeps the take where it is, "level" removes a straight-line
    #: trend, "stationary" removes all net horizontal travel.
    drift: str = "level"
    foot_lock: bool = True
    #: Seconds over which a lock fades in and out at a contact boundary.
    lock_blend: float = 0.08
    #: How much of the residual a leg is allowed to bend to absorb, 0..1.
    lock_ik: float = 1.0
    contact: ContactSettings = field(default_factory=ContactSettings)


@dataclass(slots=True)
class CleanupReport:
    """What each pass actually changed, in millimetres."""

    bone_variation_before: float = 0.0
    bone_variation_after: float = 0.0
    jitter_before: float = 0.0
    jitter_after: float = 0.0
    drift_removed: float = 0.0
    pelvis_wobble_removed: float = 0.0
    foot_slide_before: float = 0.0
    foot_slide_after: float = 0.0
    contacts: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "bone_variation_mm": [round(self.bone_variation_before, 3), round(self.bone_variation_after, 3)],
            "jitter_mm": [round(self.jitter_before, 3), round(self.jitter_after, 3)],
            "drift_removed_mm": round(self.drift_removed, 2),
            "pelvis_wobble_removed_mm": round(self.pelvis_wobble_removed, 2),
            "foot_slide_mm": [round(self.foot_slide_before, 2), round(self.foot_slide_after, 2)],
            "contacts": self.contacts,
            "notes": self.notes,
        }


def _jitter_mm(joints: np.ndarray) -> float:
    if joints.shape[0] < 3:
        return 0.0
    return float(np.median(np.linalg.norm(np.diff(joints, n=2, axis=0), axis=-1)) * 1000.0)


def _bone_variation_mm(joints: np.ndarray) -> float:
    return float(np.median(skeleton.bone_lengths(joints).std(axis=0)) * 1000.0)


def _slide_mm(joints: np.ndarray, contacts: Contacts) -> float:
    worst = 0.0
    for side, indices in skeleton.FOOT_SIDES.items():
        for start, stop in contacts.intervals.get(side, []):
            if stop - start < 3:
                continue
            margin = max(1, int(round((stop - start) * 0.2)))
            span = joints[start + margin : stop - margin][:, list(indices), :][:, :, [0, 2]]
            if span.shape[0] < 2:
                continue
            centre = span.mean(axis=1)
            worst = max(worst, float(np.linalg.norm(centre - centre[0], axis=-1).max()))
    return worst * 1000.0


def _taper(length: int, blend_frames: int) -> np.ndarray:
    """1 in the middle, easing to 0 at both ends of a contact.

    Without it a lock switches on between two frames and the body steps
    sideways by the whole of the correction in a thirtieth of a second.
    """
    ramp = np.ones(length)
    edge = int(min(blend_frames, length // 2))
    if edge > 0:
        ease = np.linspace(0.0, 1.0, edge + 2)[1:-1]
        ease = ease * ease * (3.0 - 2.0 * ease)
        ramp[:edge] = ease
        ramp[-edge:] = ease[::-1]
    return ramp


def remove_drift(joints: np.ndarray, contacts: Contacts, mode: str) -> tuple[np.ndarray, float]:
    """Takes the whole-take slide out, measured where the feet are planted."""
    if mode == "none":
        return joints, 0.0

    array = joints.copy()
    planted = contacts.any_contact
    if planted.sum() < 2:
        return array, 0.0

    # The ground position of whatever is planted. If that moves over the take
    # while a foot is supposed to be still, the world is sliding, not the body.
    anchor = np.zeros((array.shape[0], 3))
    for frame in range(array.shape[0]):
        down = [
            index
            for side, indices in skeleton.FOOT_SIDES.items()
            if contacts.mask[side][frame]
            for index in indices
        ]
        anchor[frame] = array[frame, down or list(skeleton.FOOT_JOINTS), :].mean(axis=0)

    frames = np.arange(array.shape[0], dtype=np.float64)
    correction = np.zeros_like(anchor)
    for axis in (0, 2):
        observed = anchor[planted, axis]
        if mode == "stationary":
            # Everything but the mean: the take is meant to hold one spot.
            correction[:, axis] = np.interp(frames, frames[planted], observed - observed.mean())
        else:
            # A straight-line trend only, so real locomotion survives.
            slope, intercept = np.polyfit(frames[planted], observed, 1)
            correction[:, axis] = slope * frames + intercept - observed.mean()

    array -= correction[:, None, :]
    return array, float(np.linalg.norm(correction - correction[0], axis=-1).max() * 1000.0)


def lock_feet(
    joints: np.ndarray,
    contacts: Contacts,
    *,
    blend_frames: int,
    ik_strength: float,
) -> np.ndarray:
    """Pins each planted foot, moving the body to it and the leg for the rest.

    The body is moved first because that is what actually happened: if a foot
    is on the ground and the reconstruction says it moved, the error is in
    where the reconstruction put the body. Bending the leg alone to hide it
    leaves the hips travelling through a step they never took.
    """
    array = joints.copy()
    frames = array.shape[0]

    # -- move the body onto the contacts ------------------------------------
    offset = np.zeros((frames, 3))
    weight = np.zeros(frames)
    targets: dict[tuple[str, int, int], np.ndarray] = {}

    for side, indices in skeleton.FOOT_SIDES.items():
        for start, stop in contacts.intervals.get(side, []):
            span = array[start:stop][:, list(indices), :].mean(axis=1)
            target = np.median(span, axis=0)
            target[1] = contacts.ground[side]
            targets[(side, start, stop)] = target
            ramp = _taper(stop - start, blend_frames)
            offset[start:stop] += (target - span) * ramp[:, None]
            weight[start:stop] += ramp

    live = weight > 1e-6
    offset[live] /= weight[live, None]
    # Smooth the correction itself: a lock that is right but jumps is a lock
    # nobody can use.
    offset = savgol(offset, max(3, blend_frames * 2 + 1), 1)
    array += offset[:, None, :]

    if ik_strength <= 0.0:
        return array

    # -- bend the legs for whatever is left ---------------------------------
    lengths = np.median(skeleton.bone_lengths(array), axis=0)
    bone_of = {(p, c): i for i, (p, c) in enumerate(skeleton.BONES)}

    for side in skeleton.FOOT_SIDES:
        hip_i = skeleton.INDEX[f"{side}_hip"]
        knee_i = skeleton.INDEX[f"{side}_knee"]
        ankle_i = skeleton.INDEX[f"{side}_ankle"]
        foot_i = skeleton.INDEX[f"{side}_foot"]
        thigh = float(lengths[bone_of[(hip_i, knee_i)]])
        shank = float(lengths[bone_of[(knee_i, ankle_i)]])

        for start, stop in contacts.intervals.get(side, []):
            target = targets[(side, start, stop)]
            ramp = _taper(stop - start, blend_frames) * float(np.clip(ik_strength, 0.0, 1.0))
            window = slice(start, stop)

            centre = array[window][:, [ankle_i, foot_i], :].mean(axis=1)
            want_ankle = array[window, ankle_i] + (target - centre) * ramp[:, None]

            # Bend forward, in the direction the foot is pointing.
            forward = array[window, foot_i] - array[window, ankle_i]
            forward[:, 1] = 0.0
            norm = np.linalg.norm(forward, axis=-1, keepdims=True)
            forward = np.where(norm > 1e-6, forward / np.maximum(norm, 1e-9), np.array([0.0, 0.0, 1.0]))

            knee, ankle = two_bone(array[window, hip_i], want_ankle, thigh, shank, forward=forward)
            toe_offset = array[window, foot_i] - array[window, ankle_i]
            array[window, knee_i] = knee
            array[window, ankle_i] = ankle
            array[window, foot_i] = ankle + toe_offset

    return array


def apply(
    joints: np.ndarray,
    fps: float,
    settings: CleanupSettings | None = None,
) -> tuple[np.ndarray, CleanupReport]:
    """Runs every pass and reports what each one moved."""
    config = settings or CleanupSettings()
    array = np.asarray(joints, dtype=np.float64).copy()

    before = detect(array, fps, config.contact)
    report = CleanupReport(
        bone_variation_before=_bone_variation_mm(array),
        jitter_before=_jitter_mm(array),
        foot_slide_before=_slide_mm(array, before),
        contacts={side: int(len(spans)) for side, spans in before.intervals.items()},
    )

    window = int(round(config.smooth_seconds * fps))
    if window >= 3:
        array = savgol(array, window, config.smooth_order)
    else:
        report.notes.append(
            f"smoothing skipped: {config.smooth_seconds:g}s is under 3 frames at {fps:g} fps"
        )

    # After the filter, not before: smoothing a rigid skeleton makes it
    # non-rigid again, and rigidifying a noisy one carries the noise down the
    # chain to the feet, where it costs the most.
    if config.rigidify:
        array = rigidify(array)

    # Contacts are re-detected here: the passes above have already moved the
    # feet, and locking to where they used to be would undo the smoothing.
    contacts = detect(array, fps, config.contact)

    array, report.drift_removed = remove_drift(array, contacts, config.drift)

    pelvis_window = int(round(config.pelvis_seconds * fps))
    if config.pelvis_strength > 0 and pelvis_window >= 3:
        pelvis = skeleton.INDEX["pelvis"]
        calm = savgol(array[:, pelvis : pelvis + 1, :], pelvis_window, 1)[:, 0, :]
        shift = (calm - array[:, pelvis]) * float(np.clip(config.pelvis_strength, 0.0, 1.0))
        array += shift[:, None, :]
        report.pelvis_wobble_removed = float(np.abs(shift).max() * 1000.0)

    if config.foot_lock:
        contacts = detect(array, fps, config.contact)
        array = lock_feet(
            array,
            contacts,
            blend_frames=max(1, int(round(config.lock_blend * fps))),
            ik_strength=config.lock_ik,
        )

    after = detect(array, fps, config.contact)
    report.bone_variation_after = _bone_variation_mm(array)
    report.jitter_after = _jitter_mm(array)
    report.foot_slide_after = _slide_mm(array, after)
    if not after.any_contact.any():
        report.notes.append("no foot contact detected; nothing was locked")
    return array, report
