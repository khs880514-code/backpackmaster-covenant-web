"""Configuration: layered YAML, resolved once, then read-only.

Three layers, each overriding the one before: the built-in defaults in
``configs/pipeline.yaml``, the per-source file in ``configs/sources/``, and
whatever the CLI passes with ``--set``. Resolving them once and freezing the
result is what makes a run reproducible — the settings a run used are written
into the run directory, so a report can always be traced back to them.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import yaml


class ConfigError(ValueError):
    """A configuration is missing, malformed, or asks for something absurd."""


def _deep_merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """Override leaves, merge branches. Lists replace rather than concatenate:
    a source that names two cameras means those two, not those two plus the
    defaults."""
    out = copy.deepcopy(base)
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def _coerce(text: str) -> Any:
    """Reads a ``--set`` value as YAML, so ``fps=30`` is a number and
    ``cameras=[front]`` is a list, without a second syntax to learn."""
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError:
        return text


@dataclass(frozen=True, slots=True)
class Config:
    """A resolved configuration. Read with ``get('a.b.c')``."""

    data: dict[str, Any]
    root: Path
    source_id: str | None = None

    def get(self, path: str, default: Any = None) -> Any:
        node: Any = self.data
        for part in path.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def require(self, path: str) -> Any:
        sentinel = object()
        value = self.get(path, sentinel)
        if value is sentinel:
            raise ConfigError(f"{path} is not set and has no default")
        return value

    def section(self, path: str) -> dict[str, Any]:
        value = self.get(path, {})
        if not isinstance(value, dict):
            raise ConfigError(f"{path} should be a mapping, got {type(value).__name__}")
        return value

    def fingerprint(self, *paths: str) -> str:
        """A stable hash of the settings a stage actually reads.

        Stages use it to decide whether their previous output is still valid.
        Hashing the whole configuration instead would re-run the renderer
        because somebody changed a 2D detector threshold.
        """
        import hashlib

        payload = {path: self.get(path) for path in paths}
        blob = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        return hashlib.sha256(blob).hexdigest()[:16]

    def dump(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.safe_dump(self.data, sort_keys=True, allow_unicode=True),
            encoding="utf-8",
        )


def _read(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigError(f"no configuration at {path}")
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        raise ConfigError(f"{path} should be a mapping at the top level")
    return loaded


def project_root(start: Path | None = None) -> Path:
    """The directory holding ``configs/``. Found by walking up, so the CLI
    works from anywhere inside the project."""
    here = (start or Path(__file__)).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "configs" / "pipeline.yaml").exists():
            return candidate
    raise ConfigError(
        "could not find configs/pipeline.yaml above "
        f"{here} — run from inside the project, or pass --root"
    )


def load(
    source_id: str | None = None,
    *,
    root: Path | None = None,
    overrides: Iterable[str] = (),
) -> Config:
    """Resolves defaults, then the source, then ``--set key=value`` overrides."""
    base_root = root or project_root()
    data = _read(base_root / "configs" / "pipeline.yaml")

    if source_id:
        source_path = base_root / "configs" / "sources" / f"{source_id}.yaml"
        if not source_path.exists():
            available = sorted(
                p.stem for p in (base_root / "configs" / "sources").glob("*.yaml")
            )
            raise ConfigError(
                f"no source '{source_id}'. Available: {', '.join(available) or 'none'}"
            )
        data = _deep_merge(data, _read(source_path))
        data.setdefault("source", {})["id"] = source_id

    for override in overrides:
        if "=" not in override:
            raise ConfigError(f"--set expects key=value, got {override!r}")
        key, _, raw = override.partition("=")
        node = data
        parts = key.strip().split(".")
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):
                nxt = {}
                node[part] = nxt
            node = nxt
        node[parts[-1]] = _coerce(raw.strip())

    return Config(data=data, root=base_root, source_id=source_id)


def load_preset(name: str, *, root: Path | None = None) -> dict[str, Any]:
    base_root = root or project_root()
    path = base_root / "configs" / "presets" / f"{name}.yaml"
    if not path.exists():
        available = sorted(p.stem for p in (base_root / "configs" / "presets").glob("*.yaml"))
        raise ConfigError(
            f"no preset '{name}'. Available: {', '.join(available) or 'none'}"
        )
    return _read(path)


def load_camera(name: str, *, root: Path | None = None) -> dict[str, Any]:
    base_root = root or project_root()
    path = base_root / "configs" / "cameras" / f"{name}.yaml"
    if not path.exists():
        available = sorted(p.stem for p in (base_root / "configs" / "cameras").glob("*.yaml"))
        raise ConfigError(
            f"no camera '{name}'. Available: {', '.join(available) or 'none'}"
        )
    return _read(path)


def list_sources(root: Path | None = None) -> list[str]:
    base_root = root or project_root()
    return sorted(p.stem for p in (base_root / "configs" / "sources").glob("*.yaml"))


def list_presets(root: Path | None = None) -> list[str]:
    base_root = root or project_root()
    return sorted(p.stem for p in (base_root / "configs" / "presets").glob("*.yaml"))


def list_cameras(root: Path | None = None) -> list[str]:
    base_root = root or project_root()
    return sorted(p.stem for p in (base_root / "configs" / "cameras").glob("*.yaml"))
