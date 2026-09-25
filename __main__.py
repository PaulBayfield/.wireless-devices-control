#!/usr/bin/env python3
"""The entry point. Everything it does lives in :mod:`src`.

    uv run main.py                    status of whatever is connected
    uv run main.py eq 3 0 -2          bass +3, mid flat, treble -2
    uv run main.py --device qc45 quiet
    uv run main.py probe --mac ...    map an unknown device, read-only
    uv run main.py replay sweep.json  check a model against a recording

Kept to a launcher on purpose: argument parsing, discovery and dispatch are
in :mod:`src.cli.main`, so the command line is tested and documented in the
same place as the rest of the code rather than half of it living up here.
"""

import sys
from pathlib import Path

# Running as a script puts this directory on sys.path already; adding it
# explicitly means `python path/to/main.py` works from anywhere too.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.cli.main import run  # noqa: E402

if __name__ == "__main__":
    run()
