"""The AudioModes block: listening presets and the settings inside them.

A mode slot is one named preset -- Quiet, Aware, or one the user wrote --
carrying its own noise cancellation level, spatial audio setting and wind
block flag. It is the only place a QuietComfort 45 will accept a CNC level,
because a direct write to CNC ``[1.5]`` comes back authentication-gated.

Only headphones have this block, but every headphone model seen so far uses
the same two layouts, so the codec lives here rather than in one model's
module.
"""

from .types import ModeConfig
from .vocabulary import PROMPTS

#: The mode name field is a fixed 32 bytes, null padded.
NAME_BYTES = 32


def encode_name(name):
    """Encode a mode name into the fixed 32-byte null-terminated field."""
    data = name.encode("utf-8")
    buf = bytearray(NAME_BYTES)
    end = min(len(data), NAME_BYTES - 1)
    buf[:end] = data[:end]
    buf[end] = 0
    return bytes(buf)


def parse_config(payload):
    """Parse a ModeConfig payload from AudioModes ``[31.6]``.

    Shared by the QuietComfort 45 and QuietComfort Headphones ("prince").
    A STATUS is 47 bytes::

        [0]      slot index
        [1:3]    voice prompt id
        [3]      editable   [4] configured   [5] unknown
        [6:38]   name, 32 bytes, null padded
        [41]     capability bits
        [42]     cnc level -- 0 is maximum cancellation, 10 most ambient
        [43]     auto cnc   [44] spatial audio   [46] wind block

    The echo of a SETGET is 39 bytes and drops the flag and capability
    bytes, so the tail fields sit at a lower offset. Both are read here;
    anything shorter is returned with the fields that are certain and
    defaults for the rest.

    :returns: a :class:`~src.devices.bose.protocol.types.ModeConfig`, or ``None``
        when the payload is too short to carry even a slot index.
    """
    if len(payload) < 6:
        return None

    idx = payload[0]
    prompt_bytes = (payload[1], payload[2])
    prompt = PROMPTS.get(prompt_bytes, "(%d,%d)" % prompt_bytes)

    if len(payload) >= 47:
        return ModeConfig(
            idx=idx, prompt=prompt, prompt_bytes=prompt_bytes,
            name=payload[6:38].split(b"\x00", 1)[0].decode("utf-8", "replace"),
            cnc_level=payload[42], auto_cnc=bool(payload[43]),
            spatial=payload[44], wind_block=bool(payload[46]),
            editable=bool(payload[3]), configured=bool(payload[4]),
            raw=payload,
        )
    if len(payload) >= 39:
        return ModeConfig(
            idx=idx, prompt=prompt, prompt_bytes=prompt_bytes,
            name=payload[3:35].split(b"\x00", 1)[0].decode("utf-8", "replace"),
            cnc_level=payload[35], auto_cnc=bool(payload[36]),
            spatial=payload[37], wind_block=bool(payload[38]),
            editable=True, configured=True, raw=payload,
        )
    return ModeConfig(
        idx=idx, prompt=prompt, prompt_bytes=prompt_bytes,
        name=payload[3:].split(b"\x00", 1)[0].decode("utf-8", "replace"),
        cnc_level=0, auto_cnc=False, spatial=0, wind_block=False,
        editable=False, configured=False, raw=payload,
    )


def build_config(idx, name, cnc_level=0, auto_cnc=False, spatial=0,
                 wind_block=True, prompt_bytes=(0, 0)):
    """Build the 39-byte ModeConfig SETGET payload.

    Every field is written at once, so a caller changing one of them reads
    the slot first and passes the rest back unchanged.
    """
    out = bytearray([idx, prompt_bytes[0], prompt_bytes[1]])
    out.extend(encode_name(name))
    out.append(cnc_level & 0xFF)
    out.append(1 if auto_cnc else 0)
    out.append(spatial & 0xFF)
    out.append(1 if wind_block else 0)
    return bytes(out)
