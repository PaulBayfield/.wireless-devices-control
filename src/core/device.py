"""The interface every device offers, whichever vendor made it.

Deliberately thin: identity, the name the device answers to, and its battery.
Everything else -- EQ on headphones, DPI on a mouse -- is particular to a
vendor or a model, and stays on that class rather than being squeezed into a
shape every device would have to fake.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import ClassVar, Self

from .battery import Battery


class Device(ABC):
    """One open connection to a device.

    Subclasses fill in the identity attributes and implement :meth:`name`,
    :meth:`battery` and :meth:`close`. A device is a context manager, so
    ``with found.open() as dev:`` closes the link however the block ends.
    """

    #: Who made it: ``"bose"``, ``"logitech"``.
    VENDOR: ClassVar[str] = ""
    #: What it is: ``"headphones"``, ``"speaker"``, ``"mouse"``.
    KIND: ClassVar[str] = ""
    #: Short model name, unique across vendors: ``"qc45"``, ``"g502"``.
    KEY: ClassVar[str] = ""
    #: The model's full name.
    NAME: ClassVar[str] = ""

    @abstractmethod
    def name(self) -> str:
        """The name the device itself reports, e.g. its Bluetooth name."""

    @abstractmethod
    def battery(self) -> Battery:
        """Read the battery now."""

    @abstractmethod
    def close(self) -> None:
        """Close the link to the device."""

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc) -> None:
        self.close()


@dataclass(frozen=True, slots=True)
class FoundDevice:
    """A device discovery found, before anything has been opened.

    Finding is cheap and never talks to the device's protocol for Bose (it
    reads what the OS has paired); for Logitech it pings each receiver slot.
    :meth:`open` does the expensive part and returns the connected
    :class:`Device`.
    """

    #: Stable and URL-safe: the model key and where it is, ``qc45-acbf718224e0``.
    id: str
    #: The class that drives it.
    device_class: type[Device]
    #: The name the OS or the device reports, falling back to the model name.
    name: str
    #: Where it is: a Bluetooth address, or a receiver and slot.
    address: str
    #: Whether it is reachable right now, as far as discovery can tell.
    connected: bool
    #: Opens the device and returns it, connected.
    opener: Callable[[], Device] = field(repr=False, compare=False)

    @property
    def vendor(self) -> str:
        return self.device_class.VENDOR

    @property
    def key(self) -> str:
        return self.device_class.KEY

    @property
    def kind(self) -> str:
        return self.device_class.KIND

    @property
    def model(self) -> str:
        return self.device_class.NAME

    def open(self) -> Device:
        """Connect and return the device. Close it, or use it in ``with``."""
        return self.opener()
