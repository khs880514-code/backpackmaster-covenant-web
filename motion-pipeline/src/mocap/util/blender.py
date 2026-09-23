"""Calling Blender, and reading back what it says.

Blender is driven as a subprocess rather than imported, because the `bpy`
module is a large wheel that not everyone can install and the command-line
binary is what people already have. Options go over as one JSON argument —
written to a file when it is long, since a command line has a length limit and
a preset with 24 joints in it will find it.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from .proc import Completed, require, run

SCRIPTS = Path(__file__).resolve().parent.parent / "blender"


def version() -> str | None:
    from .proc import which

    binary = which("blender")
    if not binary:
        return None
    result = run([binary, "--version"], timeout=120)
    return result.stdout.strip().splitlines()[0] if result.ok else None


def run_script(script: str, options: dict[str, Any], *, timeout: float = 7200.0) -> Completed:
    """Runs ``blender/<script>`` headless with `options` as its argument."""
    binary = require("blender")
    path = SCRIPTS / script
    if not path.exists():
        raise FileNotFoundError(f"no blender script {path}")

    payload = json.dumps(options)
    handle = None
    if len(payload) > 4000:
        handle = tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        )
        handle.write(payload)
        handle.close()
        payload = handle.name

    try:
        return run(
            [
                binary, "-b", "--factory-startup",
                "--python-exit-code", "1",
                "-P", str(path),
                "--", payload,
            ],
            timeout=timeout,
            # So `import bl_common` resolves without touching Blender's config.
            cwd=SCRIPTS,
        )
    finally:
        if handle is not None:
            Path(handle.name).unlink(missing_ok=True)


def tagged(result: Completed, tag: str) -> dict[str, Any]:
    """The JSON a script printed after `tag`, or {} when it printed none."""
    for line in result.stdout.splitlines():
        if line.startswith(f"{tag} "):
            rest = line[len(tag) + 1 :].strip()
            if rest.startswith("{"):
                try:
                    return json.loads(rest)
                except json.JSONDecodeError:
                    return {"raw": rest}
            return dict(
                part.split("=", 1) for part in rest.split() if "=" in part
            )
    return {}
