"""BMAP, the protocol Bose devices speak over RFCOMM.

The package is split by what each piece does rather than by feature:

:mod:`~.protocol.codec`
    operators, the packet codec, debug rendering
:mod:`~.protocol.errors`
    the exception hierarchy
:mod:`~.protocol.vocabulary`
    the lookup tables a payload byte is read against
:mod:`~.protocol.types`
    what a parsed payload comes back as
:mod:`~.protocol.parsers`
    payload bytes in, something typed out
:mod:`~.protocol.builders`
    something typed in, payload bytes out
:mod:`~.protocol.modes`
    the AudioModes slot codec, shared by headphones

The names most callers need are re-exported here, so ``from src import
protocol`` then ``protocol.packet(...)`` is enough for ordinary use.
"""

from . import builders, modes, parsers, types, vocabulary
from .codec import (
    ERROR_NAMES,
    OP_ERROR,
    OP_GET,
    OP_NAMES,
    OP_PROCESSING,
    OP_RESULT,
    OP_SET,
    OP_SETGET,
    OP_START,
    OP_STATUS,
    Response,
    fmt,
    packet,
    parse,
    parse_all,
)
from .errors import (
    BmapConnectionError,
    BmapDeviceError,
    BmapError,
    BmapNotFoundError,
    BmapTimeoutError,
    BmapUnsupported,
)

__all__ = [
    "builders", "modes", "parsers", "types", "vocabulary",
    "ERROR_NAMES", "OP_ERROR", "OP_GET", "OP_NAMES", "OP_PROCESSING",
    "OP_RESULT", "OP_SET", "OP_SETGET", "OP_START", "OP_STATUS",
    "Response", "fmt", "packet", "parse", "parse_all",
    "BmapConnectionError", "BmapDeviceError", "BmapError",
    "BmapNotFoundError", "BmapTimeoutError", "BmapUnsupported",
]
