"""Which implementation does a stage's work, and whether it is installed.

The heavy parts of this pipeline — a 2D detector, a 3D body recovery — are
other people's projects with their own install stories, and any of them may be
absent on a given machine. Each is wrapped as a backend that can be asked
whether it is available *before* a run starts, so a missing package is a line
from ``mocap doctor`` rather than a traceback forty minutes in.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal

Kind = Literal["pose2d", "pose3d"]


@dataclass(frozen=True, slots=True)
class Availability:
    ok: bool
    detail: str = ""


@dataclass(frozen=True, slots=True)
class Backend:
    kind: Kind
    name: str
    summary: str
    check: Callable[[], Availability]
    load: Callable[[], object]
    #: True when it needs no third-party install, so `doctor` can say what
    #: will work on a bare machine.
    builtin: bool = False


_REGISTRY: dict[tuple[str, str], Backend] = {}


def register(backend: Backend) -> Backend:
    _REGISTRY[(backend.kind, backend.name)] = backend
    return backend


def get(kind: Kind, name: str) -> Backend:
    try:
        return _REGISTRY[(kind, name)]
    except KeyError:
        known = ", ".join(sorted(n for k, n in _REGISTRY if k == kind)) or "none"
        raise KeyError(f"no {kind} backend '{name}'. Available: {known}") from None


def available(kind: Kind | None = None) -> list[Backend]:
    return [b for (k, _), b in sorted(_REGISTRY.items()) if kind is None or k == kind]


def module_present(module: str, hint: str) -> Callable[[], Availability]:
    def check() -> Availability:
        import importlib.util

        if importlib.util.find_spec(module) is None:
            return Availability(False, f"python module '{module}' not importable — {hint}")
        return Availability(True, f"{module} present")

    return check
