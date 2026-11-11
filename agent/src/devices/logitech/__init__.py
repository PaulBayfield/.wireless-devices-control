"""Logitech devices over HID++ 2.0, through a Lightspeed/Unifying receiver.

:mod:`~.logitech.hidpp`
    the protocol: report framing, feature lookup, the receiver's HID paths
:mod:`~.logitech.g502`
    the G502 LIGHTSPEED: battery, DPI, report rate, LEDs, onboard profiles

Requests are long reports ``11 <slot> <featIdx> <fn<<4|swId> <params...>``
(20 bytes), sent to the receiver's vendor collection (usage page 0xFF00);
feature indexes are looked up through ROOT. In host mode G HUB may overwrite
DPI and LED changes -- quit it, or switch to onboard mode, if they don't stick.

Adding a device
---------------

Subclass :class:`~.hidpp.HidppDevice` and :class:`~src.core.device.Device`,
set the identity attributes and ``MATCH`` (a substring of the name the
device reports), implement ``battery()``, and add the class to
:data:`MODELS`.
"""

from functools import partial

from src.core.device import FoundDevice

from .g502 import G502
from .hidpp import HidppDevice, HidppError, receiver_pids

VENDOR = "logitech"

#: Every model this package can drive, matched by the name it reports.
MODELS = (G502,)

#: Receiver slots worth asking. Unifying receivers pair up to six devices;
#: a Lightspeed receiver uses the first.
SLOTS = range(1, 7)


def model_for(reported_name):
    """The class for a device reporting *reported_name*, or ``None``."""
    for model in MODELS:
        if model.MATCH.lower() in reported_name.lower():
            return model
    return None


def scan(timeout=0.5):
    """Every supported device answering on a plugged-in receiver.

    Pings each slot of each receiver and reads the name of whatever answers.
    A device that is off or asleep does not answer, so it is not listed:
    unlike Bluetooth, the receiver keeps no pairing list this reads.

    :param timeout: how long to wait on each slot.
    """
    found = []
    for pid in receiver_pids():
        for slot in SLOTS:
            try:
                with HidppDevice(slot, pid) as dev:
                    if not dev.ping(timeout):
                        continue
                    reported = dev.name()
            except HidppError:
                continue
            model = model_for(reported)
            if model is None:
                continue
            found.append(FoundDevice(
                f"{model.KEY}-{pid:04x}-{slot}", model, reported,
                f"receiver {pid:04X} slot {slot}", True, partial(model, slot, pid)))
    return found


__all__ = ["VENDOR", "MODELS", "G502", "HidppDevice", "HidppError",
           "model_for", "scan"]
