"""Something typed in, payload out -- the other half of :mod:`.parsers`.

A feature with a builder can be written; one without is read-only, and the
device class refuses the write rather than sending bytes it cannot shape.
Range checks live here, so a nonsensical value is rejected before it reaches
the socket rather than being silently truncated by the firmware.
"""

from .vocabulary import (
    ACTION_BY_NAME,
    BUTTON_BY_NAME,
    EVENT_BY_NAME,
    MAX_NAME_BYTES,
    SIDETONE_VALUES,
    TRANSPORT_CONTROLS,
    resolve,
)


def name(new_name):
    """``[1.2]`` SETGET payload. The field holds 31 bytes of UTF-8."""
    data = new_name.encode("utf-8")
    if len(data) > MAX_NAME_BYTES:
        raise ValueError("Name must be at most %d bytes of UTF-8" % MAX_NAME_BYTES)
    return data


def eq_band(value, band_id):
    """One ``[1.7]`` SETGET payload. The three bands are written one at a time."""
    if not -10 <= value <= 10:
        raise ValueError("EQ values must be -10 to +10, got %s" % value)
    return bytes([value & 0xFF, band_id])


def toggle(enabled):
    """A one-byte on/off SETGET payload."""
    return bytes([1 if enabled else 0])


def sidetone(level):
    """``[1.11]`` SETGET payload. Byte 0 asks the device to persist the setting."""
    return bytes([1, resolve(level, SIDETONE_VALUES, "sidetone level")])


def prompts(enabled, language_id=0):
    """``[1.3]`` SETGET payload: bit 5 is the switch, the low bits the language."""
    return bytes([((1 if enabled else 0) << 5) | (language_id & 0x1F)])


def standby16(minutes):
    """``[1.4]`` SETGET payload, little-endian 16-bit."""
    if not 0 <= minutes <= 0xFFFF:
        raise ValueError("Standby timer must be 0-65535 minutes")
    return bytes([minutes & 0xFF, (minutes >> 8) & 0xFF])


def standby8(minutes):
    """``[1.4]`` SETGET payload, a single byte."""
    if not 0 <= minutes <= 0xFF:
        raise ValueError("Standby timer must be 0-255 minutes on this model")
    return bytes([minutes])


def buttons(button, event, action):
    """``[1.9]`` SETGET payload. Each argument takes a name or a numeric id."""
    return bytes([
        resolve(button, BUTTON_BY_NAME, "button"),
        resolve(event, EVENT_BY_NAME, "event"),
        resolve(action, ACTION_BY_NAME, "action"),
    ])


def volume(level):
    """``[5.5]`` SETGET payload: exactly one byte, the level.

    One byte, never two. The two-byte reply a GET returns is not an echo
    format that can be written back: the firmware reads byte 0 as the level,
    so sending the ``[steps, level]`` pair it just gave us sets the volume to
    the step count -- maximum, at once. Confirmed on a Micro 2, where writing
    back ``1f09`` produced ``1f1f``.
    """
    if not 0 <= level <= 0xFF:
        raise ValueError("Volume level must be a single byte, got %s" % level)
    return bytes([level])


def transport_control(action):
    """``[5.3]`` START payload: one byte from the AudioControlValue enum."""
    if action not in TRANSPORT_CONTROLS:
        raise ValueError("Unknown control %r (try: %s)"
                         % (action, ", ".join(sorted(TRANSPORT_CONTROLS))))
    return bytes([TRANSPORT_CONTROLS[action]])
