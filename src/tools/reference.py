"""What the addresses meant on the devices already mapped.

Printed as a hint beside a sweep, never acted on: a speaker may well use an
address for something else entirely, and the point of probing is to find out
rather than to assume. When a hint here turns out to hold on a new model,
that address graduates into
:mod:`src.devices.catalog` and stops being a guess.
"""

#: Function block id to name, as seen on the QC Ultra 2 ("wolverine").
KNOWN_BLOCKS = {
    0: "ProductInfo", 1: "Settings", 2: "Status", 3: "FirmwareUpdate",
    4: "DeviceManagement", 5: "AudioManagement", 6: "CallManagement",
    7: "Control", 8: "Debug", 9: "Notification", 18: "Authentication",
    31: "AudioModes",
}

#: ``(block, function)`` to what it held on the devices mapped so far.
KNOWN_FUNCS = {
    (0, 1): "ProductInfo.GetAll", (0, 5): "FirmwareVersion",
    (0, 3): "SerialNumber", (0, 7): "ProductName?",
    (1, 0): "Settings.FblockInfo", (1, 2): "ProductName",
    (1, 3): "VoicePrompts", (1, 4): "StandbyTimer", (1, 5): "CNC",
    (1, 7): "EQ (3-band)", (1, 9): "Buttons", (1, 10): "Multipoint",
    (1, 11): "Sidetone", (1, 12): "SetupComplete", (1, 24): "AutoPlayPause",
    (1, 27): "AutoAnswer",
    (2, 2): "BatteryLevel",
    (4, 8): "PairingMode", (4, 12): "Routing",
    (5, 1): "AudioSource", (5, 3): "AudioControl (play/pause/skip)",
    (7, 4): "Power",
    (31, 1): "AudioModes.GetAll", (31, 3): "CurrentMode",
    (31, 6): "ModeConfig", (31, 10): "AudioSettings",
}

#: Blocks worth asking about. Ids above 31 have never been seen in the wild.
BLOCK_RANGE = range(0, 32)
#: Functions worth asking about. Above 31 is rare, but cheap to skip.
FUNC_RANGE = range(0, 32)
#: RFCOMM channels to try. Windows only connects to a channel the device
#: advertises over SDP, so most of these fail instantly.
CHANNEL_RANGE = range(1, 31)
