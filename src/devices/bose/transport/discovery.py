"""Which Bose devices this machine is paired with, and which we can drive.

The platform modules answer "what is paired"; this one filters that down to
Bose hardware by vendor id and then resolves each product id through the
device registry. Nothing here opens a socket, so every function is cheap and
safe to call before a connection exists -- which is what lets ``devices`` and
``nowplaying`` work with no device awake at all.
"""

import sys

from .. import models

#: Bose's Bluetooth SIG company id.
BOSE_BT_SIG_VID = 0x009E
#: The USB vendor id shared by all Bose products. Windows reports one or the
#: other in its PnP key, depending on how the device enumerated.
BOSE_USB_VID = 0x05A7

#: Both spellings, for the membership test.
BOSE_VENDOR_IDS = (BOSE_BT_SIG_VID, BOSE_USB_VID)


def bose_devices():
    """Paired Bose devices as ``(mac, name, product_id, connected)`` tuples."""
    if sys.platform == "win32":
        return _windows()
    return _linux()


def supported_devices(device_class=None):
    """The paired devices the registry can drive.

    :param device_class: narrow the list to one model.
    :returns: ``(mac, name, device class, connected)`` tuples.
    """
    supported = []
    for mac, name, product_id, connected in bose_devices():
        found = models.for_product_id(product_id)
        if found is None:
            continue
        if device_class is not None and found is not device_class:
            continue
        supported.append((mac, name, found, connected))
    return supported


def connected_devices(device_class=None):
    """The subset of :func:`supported_devices` that is connected right now."""
    return [found for found in supported_devices(device_class) if found[3]]


def class_for_mac(mac):
    """The device class for a paired address, or ``None`` if it is unknown."""
    for found_mac, _name, product_id, _connected in bose_devices():
        if found_mac.upper() == mac.upper():
            return models.for_product_id(product_id)
    return None


def is_idle(mac):
    """Whether *mac* is paired with this machine but not currently connected.

    A paired but disconnected device is the usual reason nothing answers:
    BMAP rides the same link as audio, so the device has to be awake and
    attached to this PC -- not merely remembered by it.

    :returns: the device's name when it is idle, otherwise ``None``.
    """
    for found_mac, name, _product_id, connected in bose_devices():
        if found_mac.upper() == mac.upper() and not connected:
            return name or mac
    return None


def unmapped_devices():
    """Paired Bose devices with no module yet, for a helpful error message."""
    return [found for found in bose_devices()
            if models.for_product_id(found[2]) is None]


# -- per platform ------------------------------------------------------------

def _windows():
    """Pair up BluetoothAPIs pairing state with BTHENUM vendor/product ids."""
    from . import windows

    ids = windows.vendor_product_ids()
    found = []
    for mac, name, connected in windows.paired_devices():
        entry = ids.get(mac.replace(":", "").upper())
        if entry is None:
            continue
        vendor_id, product_id = entry
        if vendor_id in BOSE_VENDOR_IDS:
            found.append((mac, name, product_id, connected))
    return found


def _linux():
    """Keep the bluetoothctl listing that reports a Bose vendor id."""
    from . import linux

    return [(mac, name, product_id, connected)
            for mac, name, vendor_id, product_id, connected
            in linux.paired_devices()
            if vendor_id in BOSE_VENDOR_IDS]
