"""Bose SoundLink Micro 2 speaker -- codename "billie", product id 0xBC58.

Mapped from the speaker itself with :mod:`src.tools.probe`: BMAP on
RFCOMM channel 1, firmware ``8.2.16+g259c916`` on the ``OTG-QCC-384``
platform. That is the same silicon as the QC Ultra 2, which is why the block
layout matches the headphones so closely. There is no AudioModes block and no
CNC: it is a speaker.

Verified on hardware: every read below, power off, and pairing mode (read
back as ``00`` -> ``01`` -> ``00``). SETGET on the Settings block is
unauthenticated -- writing an EQ band back to its existing value was answered
with a STATUS echo, not the ``OpNotSupp`` a gated operator returns -- but the
effect of the writes has not been tried, so treat them as untested rather
than proven.

This module is the shortest one there is, and deliberately so: everything the
speaker does is in :data:`~src.devices.catalog.COMMON`, so it
declares two addresses of its own and inherits the rest.
"""

from . import catalog
from .base import Device


class SoundLinkMicro2(Device):
    """The speaker: volume, input, EQ, transport controls and power."""

    KEY = "micro2"
    NAME = "Bose SoundLink Micro 2"
    CODENAME = "billie"
    PRODUCT_ID = 0xBC58
    PLATFORM = "OTG-QCC-384"
    CHANNEL = 1
    INIT_ADDR = (0, 5)
    FALLBACK_CHANNELS = (2, 8)

    #: The speaker reports 31 steps, but a write goes through instantly and
    #: this thing is loud in a small room, so the shared ceiling stands.
    FEATURES = catalog.features(
        # A two-byte auto-off field, where the headphones use one byte.
        standby=catalog.STANDBY_16,
        # The only model so far that answers with a factory model string.
        model=catalog.MODEL,
    )

    # Every row the default status screen prints is one this speaker has,
    # and every command it offers is a shared one, chosen by the features
    # above -- so there is nothing else to declare.
