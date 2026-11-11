"""The device registry: every model this client knows how to drive.

The package is layered so that a model file stays short:

:mod:`~.models.base`
    :class:`~.models.base.Device`, the parent class
:mod:`~.models.features`
    one method per thing a device can be asked
:mod:`~.models.catalog`
    the addresses models share, written once
:mod:`~.models.status`
    the status screen, one named row at a time

Adding a device
---------------

1. **Map it.** ``uv run __main__.py bose probe --mac <address>`` sweeps an
   unknown device read-only and prints which addresses answer, which is the whole of
   the reverse engineering that matters for a new model.

2. **Write the class.** Subclass :class:`~.models.base.Device`, give it the
   identity attributes, and build ``FEATURES`` with
   :func:`~.models.catalog.features` -- naming only what the model adds to
   or differs from :data:`~.models.catalog.COMMON`. Add ``STATUS_ROWS`` if
   the default order does not suit, and ``COMMANDS`` for anything the shared
   commands do not cover. :mod:`~.models.micro2` is the short example,
   :mod:`~.models.qc45` the one with real behaviour of its own.

3. **Register it** with one line in :data:`REGISTRY`, keyed by the product
   id GET ``[0.3]`` reports -- which is also what Windows carries in its PnP
   key and what BlueZ reports as a modalias.

4. **Check it without the hardware.** ``uv run __main__.py bose replay <capture.json>``
   feeds a recorded sweep back through the class, so parsers and the status
   screen can be checked against real bytes while the device is asleep.

Discovery, the CLI and the help text all read from this registry, so nothing
else has to change.
"""

from .base import Device
from .micro2 import SoundLinkMicro2
from .qc45 import QuietComfort45

#: Product id -> device class. The id is what GET ``[0.3]`` returns and what
#: both Windows and BlueZ report for a paired device.
REGISTRY = {
    QuietComfort45.PRODUCT_ID: QuietComfort45,   # 0x4039
    SoundLinkMicro2.PRODUCT_ID: SoundLinkMicro2,  # 0xBC58
}

#: Short name -> class, for ``--device qc45`` when several are connected.
BY_KEY = {cls.KEY: cls for cls in REGISTRY.values()}


def for_product_id(product_id):
    """The class that drives this product id, or ``None`` if it is unknown."""
    return REGISTRY.get(product_id)


def for_key(key):
    """The class with this short name, or ``None``."""
    return BY_KEY.get(key.lower())


def all_devices():
    """Every registered class, in a stable order for help output."""
    return sorted(REGISTRY.values(), key=lambda cls: cls.NAME)


def keys():
    """Every short name, for error messages."""
    return sorted(BY_KEY)


__all__ = ["Device", "QuietComfort45", "SoundLinkMicro2", "REGISTRY",
           "BY_KEY", "for_product_id", "for_key", "all_devices", "keys"]
