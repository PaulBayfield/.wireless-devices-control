"""BoseControl -- dependency-free control of Bose hardware over BMAP.

It opens a Bluetooth RFCOMM socket and speaks BMAP, the same protocol the
Bose app uses: no app, no cloud, no account. Everything is standard library.

Layout
------

:mod:`~src.protocol`
    the wire format: codec, parsers, builders
:mod:`~src.devices`
    the models, and the parent class they share
:mod:`~src.transport`
    RFCOMM, and finding what is paired
:mod:`~src.cli`
    the command line
:mod:`~src.tools`
    probing an unknown device, and replaying a sweep
:mod:`~src.media`
    what this PC is playing, via Windows
:mod:`~src.output`
    colours, rows and meters

Using it as a library
---------------------

::

    from src import connect

    with connect() as dev:
        print(dev.battery())
        dev.set_volume(8)

:func:`~src.transport.session.connect` finds a connected device,
opens the right channel and returns the class that drives that model.
"""

__version__ = "1.0.0"

from .devices import Device
from .protocol.errors import (
    BmapConnectionError,
    BmapDeviceError,
    BmapError,
    BmapNotFoundError,
    BmapTimeoutError,
    BmapUnsupported,
)
from .transport import connect

__all__ = [
    "__version__", "Device", "connect",
    "BmapConnectionError", "BmapDeviceError", "BmapError",
    "BmapNotFoundError", "BmapTimeoutError", "BmapUnsupported",
]
