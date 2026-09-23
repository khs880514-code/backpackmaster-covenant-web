"""Running other programs, and saying something useful when they are absent."""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


class ToolMissing(RuntimeError):
    """A required external program is not on PATH."""

    def __init__(self, tool: str, hint: str) -> None:
        super().__init__(f"{tool} is not installed or not on PATH.\n  {hint}")
        self.tool = tool
        self.hint = hint


INSTALL_HINTS = {
    "ffmpeg": "apt-get install ffmpeg   (or: brew install ffmpeg)",
    "ffprobe": "ships with ffmpeg — apt-get install ffmpeg",
    "blender": (
        "apt-get install blender, or download from blender.org and put it on "
        "PATH, or set MOCAP_BLENDER to the executable"
    ),
}


def which(tool: str) -> str | None:
    """Where a tool is, honouring MOCAP_<TOOL> as an override."""
    override = os.environ.get(f"MOCAP_{tool.upper()}")
    if override:
        return override if Path(override).exists() else None
    return shutil.which(tool)


def require(tool: str) -> str:
    found = which(tool)
    if not found:
        raise ToolMissing(tool, INSTALL_HINTS.get(tool, f"install {tool}"))
    return found


@dataclass(slots=True)
class Completed:
    args: list[str]
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def check(self) -> "Completed":
        if not self.ok:
            tail = "\n".join(self.stderr.strip().splitlines()[-15:])
            raise RuntimeError(
                f"{Path(self.args[0]).name} exited {self.returncode}\n"
                f"  {' '.join(self.args[1:8])}{' …' if len(self.args) > 9 else ''}\n"
                f"{tail}"
            )
        return self


def run(args: Sequence[str], *, timeout: float | None = None, cwd: Path | None = None) -> Completed:
    proc = subprocess.run(  # noqa: S603 - argv list, never a shell string
        list(args),
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(cwd) if cwd else None,
        check=False,
    )
    return Completed(list(args), proc.returncode, proc.stdout, proc.stderr)
