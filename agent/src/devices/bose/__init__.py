"""Bose hardware over BMAP, the protocol the Bose app speaks.

It opens a Bluetooth RFCOMM socket and speaks BMAP directly: no app, no
cloud, no account, and nothing outside the standard library.

Layout
------

:mod:`~.bose.protocol`
    the wire format: codec, parsers, builders
:mod:`~.bose.models`
    the models, and the parent class they share
:mod:`~.bose.transport`
    RFCOMM, and finding what is paired
:mod:`~.bose.tools`
    probing an unknown device, and replaying a sweep

Using it as a library
---------------------

::

    from src.devices.bose import connect

    with connect() as dev:
        print(dev.battery())
        dev.set_volume(8)

:func:`~src.devices.bose.transport.session.connect` finds a connected
device, opens the right channel and returns the class that drives that model.
"""

from functools import partial

from src.core.device import FoundDevice

from .models import Device
from .protocol.errors import (
    BmapConnectionError,
    BmapDeviceError,
    BmapError,
    BmapNotFoundError,
    BmapTimeoutError,
    BmapUnsupported,
)
from .transport import connect, supported_devices

VENDOR = "bose"


def scan(timeout=3.0):
    """Every paired Bose device this client can drive, as ``FoundDevice``.

    Reads the OS pairing list only -- no socket is opened -- so it is fast and
    works with everything asleep. ``connected`` is the OS's word on whether
    the device is attached right now.

    :param timeout: the per-exchange deadline the opened device will use.
    """
    return [
        FoundDevice("%s-%s" % (device_class.KEY, mac.replace(":", "").lower()),
                    device_class, name or device_class.NAME, mac, connected,
                    partial(connect, mac=mac, key=device_class.KEY,
                            timeout=timeout))
        for mac, name, device_class, connected in supported_devices()
    ]


__all__ = [
    "VENDOR", "Device", "connect", "scan",
    "BmapConnectionError", "BmapDeviceError", "BmapError",
    "BmapNotFoundError", "BmapTimeoutError", "BmapUnsupported",
]
