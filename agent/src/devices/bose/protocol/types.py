"""What a parsed payload comes back as.

Every parser returns either a plain value or one of these named tuples, so a
caller reads ``source.mac`` rather than indexing into bytes, and the layout
stays documented in one place.
"""

from collections import namedtuple

#: One EQ band: its id, display name, permitted range and current value.
EqBand = namedtuple("EqBand", ["band_id", "name", "min_val", "max_val", "current"])

#: One slot from the AudioModes block: a named preset with its own noise
#: cancellation level, spatial audio setting and wind block flag.
ModeConfig = namedtuple("ModeConfig", [
    "idx", "name", "prompt", "prompt_bytes", "cnc_level", "auto_cnc",
    "spatial", "wind_block", "editable", "configured", "raw",
])

#: A button gesture and what it currently does, plus everything it accepts.
ButtonMapping = namedtuple("ButtonMapping", [
    "button_id", "button_name", "event", "event_name",
    "action", "action_name", "supported_actions",
])

#: The active input, and the address it is playing from over Bluetooth.
AudioSource = namedtuple("AudioSource", ["kind", "mac"])

#: The addresses a device remembers, behind one leading byte of unknown meaning.
DeviceList = namedtuple("DeviceList", ["lead_byte", "macs"])
