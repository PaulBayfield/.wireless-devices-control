"""One battery reading, whatever the device and however it measures it.

Bose headphones report a percentage directly; a Logitech mouse reports
millivolts that have to be read against a discharge curve. Both end up here,
so the server and the CLI can show every device the same way without
knowing which protocol produced the number.
"""

from dataclasses import dataclass
from enum import StrEnum


class ChargeState(StrEnum):
    """What the charger is doing, as far as the device says."""

    DISCHARGING = "discharging"
    CHARGING = "charging"
    #: On the charger and topped up.
    FULL = "full"
    #: On a charger that is not charging it, e.g. too hot or too cold.
    NOT_CHARGING = "not charging"
    ERROR = "error"
    #: The device reports a level but not whether it is charging.
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class Battery:
    """A battery reading.

    :param percent: charge left, 0-100, or ``None`` when the device answered
        without a level.
    :param state: charging state, :attr:`ChargeState.UNKNOWN` when the
        device does not report one.
    :param millivolts: the raw cell voltage, for devices that measure it.
    """

    percent: int | None
    state: ChargeState = ChargeState.UNKNOWN
    millivolts: int | None = None

    @property
    def charging(self) -> bool | None:
        """Whether it is on the charger right now, ``None`` when unknown."""
        if self.state is ChargeState.UNKNOWN:
            return None
        return self.state is not ChargeState.DISCHARGING

    def __str__(self) -> str:
        level = "?" if self.percent is None else f"{self.percent}%"
        details = [str(self.state)] if self.state is not ChargeState.UNKNOWN else []
        if self.millivolts is not None:
            details.append(f"{self.millivolts} mV")
        return f"{level} ({', '.join(details)})" if details else level
