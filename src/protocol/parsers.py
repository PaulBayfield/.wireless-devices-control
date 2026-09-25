"""Payload in, something typed out.

Each function here takes the payload bytes of one STATUS packet and returns a
plain value or one of the types in :mod:`src.protocol.types`. They
know nothing about which device sent them: a device class names the ones it
needs in its feature table, which is what lets two unrelated models share a
parser whenever their firmware shares a layout.

Anything genuinely particular to one model lives in that model's own module
instead.
"""

from .types import AudioSource, ButtonMapping, DeviceList, EqBand
from .vocabulary import (
    ACTION_MODES,
    BUTTON_EVENTS,
    BUTTON_IDS,
    SIDETONE_NAMES,
    SOURCE_TYPES,
    TRANSPORT_CONTROLS,
    VOICE_LANGUAGES,
    signed,
)

#: EQ band id to display name.
_BAND_NAMES = {0: "Bass", 1: "Mid", 2: "Treble"}


def battery(payload):
    """``[2.2]`` -> charge percentage."""
    return payload[0] if payload else None


def text(payload):
    """A payload that is simply a string, such as a firmware version."""
    return payload.decode("utf-8", "replace")


def flagged_name(payload):
    """``[1.2]`` -> the device name. Byte 0 is a flag, the name follows it."""
    return payload[1:].decode("utf-8", "replace")


def eq(payload):
    """``[1.7]`` -> a list of :class:`~src.protocol.types.EqBand`.

    The payload repeats ``[min, max, current, band_id]`` groups, one per band.
    """
    bands = []
    for i in range(0, len(payload) - 3, 4):
        band_id = payload[i + 3]
        bands.append(EqBand(
            band_id=band_id, name=_BAND_NAMES.get(band_id, "Band%d" % band_id),
            min_val=signed(payload[i]), max_val=signed(payload[i + 1]),
            current=signed(payload[i + 2]),
        ))
    return bands


def cnc(payload):
    """``[1.5]`` -> ``(level, max)``. Level 0 is maximum cancellation."""
    if len(payload) >= 3:
        return (payload[1], payload[0] - 1)
    return (0, 10)


def multipoint(payload):
    """``[1.10]`` -> whether multipoint is on. Bit 1 carries the state."""
    return bool(payload[0] & 0x02) if payload else False


def sidetone(payload):
    """``[1.11]`` -> the sidetone level name."""
    level = payload[1] if len(payload) >= 2 else 0
    return SIDETONE_NAMES.get(level, "unknown(%d)" % level)


def prompts(payload):
    """``[1.3]`` -> ``(enabled, language name)``. Bit 5 is the switch."""
    if not payload:
        return (False, "")
    lang = payload[0] & 0x1F
    return (bool((payload[0] >> 5) & 1),
            VOICE_LANGUAGES.get(lang, "lang%d" % lang))


def standby(payload):
    """``[1.4]`` -> the auto-off timer in minutes.

    The field width varies by model: a QC45 answers one byte (``b4``, 180
    minutes), a SoundLink Micro 2 two, little-endian (``3c00``, 60). The
    length says which, so this reads both. The builders stay separate --
    a writer has to know how wide the field is.
    """
    if not payload:
        return None
    if len(payload) == 1:
        return payload[0]
    return payload[0] | (payload[1] << 8)


def product_id(payload):
    """``[0.3]`` -> ``(product id, variant)``. A QC45 answers ``403901``."""
    if len(payload) >= 2:
        variant = payload[2] if len(payload) >= 3 else None
        return ((payload[0] << 8) | payload[1], variant)
    return (None, None)


def device_list(payload):
    """``[4.4]`` -> a :class:`~src.protocol.types.DeviceList`.

    One leading byte, then six bytes per address. On a QC45 that byte read
    ``03`` while five addresses followed, so it is not simply the count --
    it is handed back as-is rather than guessed at.
    """
    if not payload:
        return DeviceList(None, [])
    macs = [":".join("%02X" % b for b in payload[i:i + 6])
            for i in range(1, len(payload) - 5, 6)]
    return DeviceList(payload[0], macs)


def buttons(payload):
    """``[1.9]`` -> the current mapping, plus every action the device accepts.

    Bytes 3 to 6 are a bitmap over
    :data:`~src.protocol.vocabulary.ACTION_MODES`.
    """
    if len(payload) < 3:
        return None
    supported = []
    for byte_idx, byte in enumerate(payload[3:7]):
        for bit in range(8):
            action_id = byte_idx * 8 + bit
            if byte & (1 << bit) and action_id > 0:
                supported.append(ACTION_MODES.get(action_id,
                                                  "unknown(%d)" % action_id))
    return ButtonMapping(
        button_id=payload[0],
        button_name=BUTTON_IDS.get(payload[0], "0x%02x" % payload[0]),
        event=payload[1],
        event_name=BUTTON_EVENTS.get(payload[1], str(payload[1])),
        action=payload[2],
        action_name=ACTION_MODES.get(payload[2], str(payload[2])),
        supported_actions=supported,
    )


def source(payload):
    """``[5.1]`` -> the active input and, over Bluetooth, its address.

    Layout: ``[supported_hi, supported_lo, active_type, ...source data]``.
    """
    if len(payload) < 3:
        return AudioSource("none", None)
    kind = SOURCE_TYPES.get(payload[2], "unknown(%d)" % payload[2])
    address = None
    if payload[2] == 1 and len(payload) >= 9:
        address = ":".join("%02X" % b for b in payload[3:9])
    return AudioSource(kind, address)


def volume(payload):
    """``[5.5]`` -> ``(level, steps)``.

    Byte 0 is the step count, byte 1 the level.
    """
    if len(payload) >= 2:
        return (payload[1], payload[0])
    return (None, None)


def mac(payload):
    """A raw six-byte address, as ``[0.6]`` and ``[4.9]`` return it."""
    return ":".join("%02X" % b for b in payload[:6])


def transport_controls(payload):
    """``[5.3]`` -> the control names this device says it accepts.

    The payload is a big-endian bitmap indexed by
    :data:`~src.protocol.vocabulary.TRANSPORT_CONTROLS`.
    """
    if not payload:
        return []
    bitmap = int.from_bytes(payload, "big")
    return [control for control, value in sorted(TRANSPORT_CONTROLS.items(),
                                                 key=lambda kv: kv[1])
            if bitmap & (1 << value)]
