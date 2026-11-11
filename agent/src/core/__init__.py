"""What every vendor package shares.

:mod:`~.core.device`
    :class:`~.core.device.Device`, the interface every device implements,
    and :class:`~.core.device.FoundDevice`, what discovery hands back
:mod:`~.core.battery`
    :class:`~.core.battery.Battery`, one reading in one shape
:mod:`~.core.errors`
    :class:`~.core.errors.DeviceError`, the base of every vendor's errors
:mod:`~.core.output`
    terminal colours, aligned rows and meters, for the CLI
:mod:`~.core.media`
    what this PC is playing, via the Windows media session
"""

from .battery import Battery, ChargeState
from .device import Device, FoundDevice
from .errors import DeviceError

__all__ = ["Battery", "ChargeState", "Device", "DeviceError", "FoundDevice"]
