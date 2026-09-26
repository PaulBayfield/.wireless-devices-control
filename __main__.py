#!/usr/bin/env python3
"""The entry point. Everything it does lives in :mod:`src`.

    uv run __main__.py                  battery of every device
    uv run __main__.py devices          everything discovery finds
    uv run __main__.py bose eq 3 0 -2   bass +3, mid flat, treble -2
    uv run __main__.py logitech dpi 1600

Kept to a launcher on purpose: argument parsing, discovery and dispatch are
in :mod:`src.cli.main`.
"""

import sys
from pathlib import Path

# Running as a script puts this directory on sys.path already; adding it
# explicitly means `python path/to/__main__.py` works from anywhere too.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.cli.main import run  # noqa: E402

if __name__ == "__main__":
    run()
