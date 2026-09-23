"""What makes a recovered motion good enough to retarget.

Every metric here answers a question you would otherwise answer by squinting
at a playblast: is the skeleton rigid, is it steady, do the feet stay put, is
it above the floor, and was the subject visible throughout. Each returns a
number with a unit, a threshold it is judged against, and a verdict — because
"looks fine" does not survive the third take and cannot be diffed.

The thresholds are defaults, not laws; they live in configs/pipeline.yaml and
a source can override any of them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import numpy as np

from .. import skeleton
from ..contact import ContactSettings, Contacts, detect, speeds

Verdict = Literal["pass", "warn", "fail"]

#: Share of each contact interval ignored at either end, where the foot is
#: rolling on or off rather than planted.
EDGE_TRIM = 0.2


@dataclass(frozen=True, slots=True)
class Metric:
    key: str
    title: str
    value: float
    unit: str
    warn_above: float | None = None
    fail_above: float | None = None
    warn_below: float | None = None
    fail_below: float | None = None
    detail: str = ""
    #: Per-joint or per-bone breakdown, worst first, for the report.
    worst: tuple[tuple[str, float], ...] = ()
    #: Whether stage 6 can fix this. Gating the raw recovery on something the
    #: cleanup exists to remove means never reaching the cleanup: a take is
    #: stopped for jitter that the next stage would have taken out. What
    #: cannot be recovered is what was never seen.
    recoverable: bool = True

    @property
    def verdict(self) -> Verdict:
        if self.fail_above is not None and self.value > self.fail_above:
            return "fail"
        if self.fail_below is not None and self.value < self.fail_below:
            return "fail"
        if self.warn_above is not None and self.value > self.warn_above:
            return "warn"
        if self.warn_below is not None and self.value < self.warn_below:
            return "warn"
        return "pass"

    @property
    def limit(self) -> str:
        parts = []
        if self.warn_above is not None:
            parts.append(f"warn >{self.warn_above:g}")
        if self.fail_above is not None:
            parts.append(f"fail >{self.fail_above:g}")
        if self.warn_below is not None:
            parts.append(f"warn <{self.warn_below:g}")
        if self.fail_below is not None:
            parts.append(f"fail <{self.fail_below:g}")
        return ", ".join(parts)


@dataclass(slots=True)
class Assessment:
    metrics: list[Metric] = field(default_factory=list)
    frames: int = 0
    fps: float = 0.0
    contacts: Contacts | None = None

    @property
    def verdict(self) -> Verdict:
        verdicts = {m.verdict for m in self.metrics}
        if "fail" in verdicts:
            return "fail"
        if "warn" in verdicts:
            return "warn"
        return "pass"

    @property
    def usable(self) -> bool:
        """Whether this take should go on to be retargeted."""
        return self.verdict != "fail"

    @property
    def unrecoverable(self) -> list[Metric]:
        """Failures the cleanup cannot do anything about."""
        return [m for m in self.metrics if m.verdict == "fail" and not m.recoverable]

    @property
    def recoverable_faults(self) -> list[Metric]:
        return [m for m in self.metrics if m.verdict != "pass" and m.recoverable]

    def by_key(self, key: str) -> Metric | None:
        return next((m for m in self.metrics if m.key == key), None)

    def as_dict(self) -> dict[str, object]:
        return {
            "verdict": self.verdict,
            "frames": self.frames,
            "fps": self.fps,
            "duration": round(self.frames / self.fps, 3) if self.fps else 0.0,
            "metrics": [
                {
                    "key": m.key,
                    "title": m.title,
                    "value": round(m.value, 6),
                    "unit": m.unit,
                    "verdict": m.verdict,
                    "recoverable": m.recoverable,
                    "limit": m.limit,
                    "detail": m.detail,
                    "worst": [[name, round(v, 6)] for name, v in m.worst],
                }
                for m in self.metrics
            ],
        }


def _worst(values: np.ndarray, names: list[str], count: int = 5) -> tuple[tuple[str, float], ...]:
    order = np.argsort(values)[::-1][:count]
    return tuple((names[i], float(values[i])) for i in order)


def bone_rigidity(joints: np.ndarray) -> Metric:
    """How much the bones change length, as a percentage of their own length.

    A skeleton is rigid. Anything else is the 3D recovery guessing depth
    differently from one frame to the next, and it is the first thing to look
    at because every other metric inherits it.
    """
    lengths = skeleton.bone_lengths(joints)
    mean = lengths.mean(axis=0)
    spread = lengths.std(axis=0) / np.maximum(mean, 1e-6) * 100.0
    names = [
        f"{skeleton.JOINT_NAMES[p]}->{skeleton.JOINT_NAMES[c]}" for p, c in skeleton.BONES
    ]
    return Metric(
        key="bone_rigidity",
        title="Bone length variation",
        value=float(np.median(spread)),
        unit="%",
        warn_above=1.5,
        fail_above=4.0,
        detail="median across bones of each bone's length variation over the take",
        worst=_worst(spread, names),
    )


def jitter(joints: np.ndarray, fps: float) -> Metric:
    """Frame-to-frame shake, as the median joint acceleration in mm/frame².

    Second differences, not first: a fast limb is not jitter, but a limb that
    reverses every frame is. Taking the median over joints keeps one badly
    tracked wrist from condemning a take.
    """
    array = np.asarray(joints, dtype=np.float64)
    if array.shape[0] < 3:
        return Metric("jitter", "Jitter", 0.0, "mm/frame²", detail="too few frames")
    accel = np.linalg.norm(np.diff(array, n=2, axis=0), axis=-1) * 1000.0
    per_joint = np.median(accel, axis=0)
    return Metric(
        key="jitter",
        title="Jitter",
        value=float(np.median(per_joint)),
        unit="mm/frame²",
        warn_above=6.0,
        fail_above=18.0,
        detail="median joint acceleration; second differences, so speed is not penalised",
        worst=_worst(per_joint, list(skeleton.JOINT_NAMES)),
    )


def foot_slide(joints: np.ndarray, fps: float, contacts: Contacts) -> Metric:
    """How far a foot travels along the ground while it is supposed to be on it.

    The artefact everybody sees and nobody can name: the figure skates. It is
    measured only inside detected contact, because a foot moving through the
    air is a kick, not a defect.
    """
    array = np.asarray(joints, dtype=np.float64)
    per_side: dict[str, float] = {}
    for side, indices in skeleton.FOOT_SIDES.items():
        mask = contacts.mask.get(side)
        if mask is None or not mask.any():
            per_side[side] = 0.0
            continue
        worst = 0.0
        for start, stop in contacts.intervals[side]:
            # Trim the ends of the contact. A foot rolls onto the ground and
            # rolls off it, and both are real; counting them measures the gait
            # rather than the skating. Measured on a fixture whose support
            # foot is planted to the millimetre, untrimmed edges reported
            # 46mm of slide that was the kicking foot leaving the floor.
            margin = int(round((stop - start) * EDGE_TRIM))
            lo, hi = start + margin, stop - margin
            if hi - lo < 2:
                continue
            span = array[lo:hi][:, list(indices), :][:, :, [0, 2]]
            centre = span.mean(axis=1)
            worst = max(worst, float(np.linalg.norm(centre - centre[0], axis=-1).max()))
        per_side[side] = worst * 1000.0
    value = max(per_side.values()) if per_side else 0.0
    return Metric(
        key="foot_slide",
        title="Foot slide during contact",
        value=value,
        unit="mm",
        warn_above=20.0,
        fail_above=60.0,
        detail="furthest a planted foot drifts horizontally within one contact",
        worst=tuple(sorted(per_side.items(), key=lambda kv: -kv[1])),
    )


def ground_penetration(joints: np.ndarray, contacts: Contacts) -> Metric:
    """How far the lowest foot goes below the ground it established."""
    array = np.asarray(joints, dtype=np.float64)
    floor = min(contacts.ground.values()) if contacts.ground else 0.0
    depth = np.clip(floor - array[:, list(skeleton.FOOT_JOINTS), 1], 0.0, None) * 1000.0
    per_joint = depth.max(axis=0)
    names = [skeleton.JOINT_NAMES[i] for i in skeleton.FOOT_JOINTS]
    return Metric(
        key="ground_penetration",
        title="Ground penetration",
        value=float(per_joint.max()) if per_joint.size else 0.0,
        unit="mm",
        warn_above=25.0,
        fail_above=80.0,
        detail="deepest a foot goes below the floor the contacts established",
        worst=_worst(per_joint, names, count=4),
    )


def coverage(confidence: np.ndarray | None, threshold: float = 0.3) -> Metric:
    """The share of frames where the body was actually seen.

    A take the detector lost for a second will be smooth and wrong. This is
    the metric that catches it, and it is why stage 2 writes confidence rather
    than discarding it.
    """
    if confidence is None:
        return Metric(
            key="coverage",
            title="Tracking coverage",
            value=100.0,
            unit="%",
            detail="no confidence recorded; assuming fully observed",
            recoverable=False,
        )
    seen = (np.asarray(confidence) >= threshold)
    per_joint = seen.mean(axis=0) * 100.0
    return Metric(
        key="coverage",
        title="Tracking coverage",
        value=float(per_joint.mean()),
        unit="%",
        warn_below=92.0,
        fail_below=75.0,
        detail=f"mean share of frames a joint was seen at confidence >= {threshold:g}",
        recoverable=False,
        worst=tuple(
            (skeleton.JOINT_NAMES[i], float(per_joint[i]))
            for i in np.argsort(per_joint)[:5]
        ),
    )


def longest_gap(confidence: np.ndarray | None, fps: float, threshold: float = 0.3) -> Metric:
    """The longest unbroken run of not seeing the subject, in seconds."""
    if confidence is None:
        return Metric(
            "longest_gap", "Longest tracking gap", 0.0, "s",
            detail="no confidence recorded", recoverable=False,
        )
    core = [skeleton.INDEX[n] for n in ("pelvis", "left_hip", "right_hip", "neck")]
    lost = (np.asarray(confidence)[:, core] < threshold).all(axis=1)
    longest = 0
    current = 0
    for value in lost:
        current = current + 1 if value else 0
        longest = max(longest, current)
    return Metric(
        key="longest_gap",
        title="Longest tracking gap",
        value=longest / fps if fps else 0.0,
        unit="s",
        warn_above=0.15,
        fail_above=0.5,
        detail="longest run of frames with no core body joint visible",
        recoverable=False,
    )


def root_stability(joints: np.ndarray, fps: float, contacts: Contacts) -> Metric:
    """Horizontal travel of the pelvis that no planted foot accounts for.

    A take shot from a hand-held phone drifts: the subject stands still and
    the reconstruction walks. Measuring the pelvis against the feet separates
    that from a step, which is real motion nobody should remove.
    """
    array = np.asarray(joints, dtype=np.float64)
    pelvis = array[:, skeleton.INDEX["pelvis"]][:, [0, 2]]
    planted = contacts.any_contact
    if planted.sum() < 2:
        travel = float(np.linalg.norm(pelvis - pelvis[0], axis=-1).max())
        return Metric(
            key="root_stability",
            title="Unexplained root travel",
            value=travel * 1000.0,
            unit="mm",
            warn_above=150.0,
            fail_above=350.0,
            detail="no contact detected, so all pelvis travel counts as unexplained",
        )
    # Against the feet that are actually on the ground this frame. Averaging
    # both feet lets a kicking leg swinging through the air move the reference
    # by more than the drift being measured — on a fixture with a perfectly
    # planted support foot that read as 420mm of travel that did not happen.
    anchor = np.zeros_like(pelvis)
    for frame in range(array.shape[0]):
        down = [
            index
            for side, indices in skeleton.FOOT_SIDES.items()
            if contacts.mask[side][frame]
            for index in indices
        ]
        chosen = down or list(skeleton.FOOT_JOINTS)
        anchor[frame] = array[frame, chosen, :][:, [0, 2]].mean(axis=0)
    relative = (pelvis - anchor)[planted]
    return Metric(
        key="root_stability",
        title="Unexplained root travel",
        value=float(np.linalg.norm(relative - relative[0], axis=-1).max()) * 1000.0,
        unit="mm",
        warn_above=150.0,
        fail_above=350.0,
        detail=(
            "pelvis travel measured against whichever foot is planted, so a "
            "step does not count. A kick shifts the hips a hand's width on "
            "purpose; this is looking for the reconstruction wandering off"
        ),
    )


def assess(
    joints: np.ndarray,
    fps: float,
    *,
    confidence: np.ndarray | None = None,
    contact_settings: ContactSettings | None = None,
    thresholds: dict[str, dict[str, float]] | None = None,
) -> Assessment:
    """Every metric, against the configured thresholds."""
    array = np.asarray(joints, dtype=np.float64)
    contacts = detect(array, fps, contact_settings)
    metrics = [
        bone_rigidity(array),
        jitter(array, fps),
        foot_slide(array, fps, contacts),
        ground_penetration(array, contacts),
        root_stability(array, fps, contacts),
        coverage(confidence),
        longest_gap(confidence, fps),
    ]

    if thresholds:
        adjusted = []
        for metric in metrics:
            limits = thresholds.get(metric.key)
            if not limits:
                adjusted.append(metric)
                continue
            adjusted.append(
                Metric(
                    **{
                        **{
                            f.name: getattr(metric, f.name)
                            for f in metric.__dataclass_fields__.values()  # type: ignore[attr-defined]
                        },
                        **{k: float(v) for k, v in limits.items() if k.startswith(("warn_", "fail_"))},
                    }
                )
            )
        metrics = adjusted

    return Assessment(metrics=metrics, frames=int(array.shape[0]), fps=fps, contacts=contacts)
