"""One logger, configured once, readable in a terminal."""

from __future__ import annotations

import logging
import sys

_CONFIGURED = False


class _Brief(logging.Formatter):
    MARK = {
        logging.DEBUG: "  ",
        logging.INFO: "· ",
        logging.WARNING: "! ",
        logging.ERROR: "x ",
        logging.CRITICAL: "X ",
    }

    def format(self, record: logging.LogRecord) -> str:
        return f"{self.MARK.get(record.levelno, '  ')}{record.getMessage()}"


def configure(verbose: bool = False, quiet: bool = False) -> None:
    global _CONFIGURED
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_Brief())
    root = logging.getLogger("mocap")
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if verbose else logging.ERROR if quiet else logging.INFO)
    root.propagate = False
    _CONFIGURED = True


def get_logger(name: str = "mocap") -> logging.Logger:
    if not _CONFIGURED:
        configure()
    return logging.getLogger(name)
