"""Every vendor this project can drive, and discovery across all of them.

Each vendor is its own package with its own protocol, transport and models:

:mod:`~.devices.bose`
    BMAP over Bluetooth RFCOMM
:mod:`~.devices.logitech`
    HID++ 2.0 over a Lightspeed USB receiver

They meet in :func:`scan`, which asks each vendor what it can see and returns
:class:`~src.core.device.FoundDevice` records that all open the same way.

Adding a vendor
---------------

Give the package a ``VENDOR`` name and a ``scan()`` returning
``FoundDevice`` records, make its device classes subclass
:class:`~src.core.device.Device`, root its errors in
:class:`~src.core.errors.DeviceError`, and add it to :data:`VENDORS`.
"""

from src.core.device import FoundDevice
from src.core.errors import DeviceError

from . import bose, logitech

#: Every vendor package, in the order :func:`scan` asks them.
VENDORS = (bose, logitech)


def scan(vendors=VENDORS):
    """Every supported device any vendor can see, connected or not.

    A vendor whose discovery fails -- no Bluetooth radio, the receiver
    unplugged -- contributes nothing rather than sinking the rest.

    :returns: a list of :class:`~src.core.device.FoundDevice`.
    """
    found = []
    for vendor in vendors:
        try:
            found.extend(vendor.scan())
        except (DeviceError, OSError):
            continue
    return found


__all__ = ["VENDORS", "FoundDevice", "scan", "bose", "logitech"]
