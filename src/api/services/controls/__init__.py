"""What the API can read and change on each vendor's devices, as plain JSON.

Each vendor module offers the same four functions, all called with an open
device inside :meth:`~src.api.services.manager.DeviceManager.run`:

``read(dev) -> dict``
    every setting the model has, with the ranges a UI needs to draw it
``apply(dev, changes: dict) -> None``
    change some settings; unknown or invalid fields raise ``ValueError``
``act(dev, action: str, params: dict) -> None``
    a one-shot action (play, power off...); unknown ones raise ``ValueError``

Only settings the model actually has appear in ``read``, and only those are
accepted by ``apply``, so a client can draw exactly what is in front of it.
"""

from . import bose, logitech

#: Vendor name to its controls module.
CONTROLS = {
    "bose": bose,
    "logitech": logitech,
}


def for_vendor(vendor: str):
    """The controls module for *vendor*."""
    return CONTROLS[vendor]


__all__ = ["CONTROLS", "for_vendor"]
