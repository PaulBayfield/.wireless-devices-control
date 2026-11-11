"""The lookup tables: every enum a payload byte can be read against.

These come from the Bose app's own constants, confirmed against what real
hardware answers. They are pure data with no behaviour, which is why they sit
apart from the parsers that use them -- a new model usually needs a new row
here rather than new code.
"""

#: The device name field holds at most this many bytes of UTF-8.
MAX_NAME_BYTES = 31

#: Sidetone level id to name.
SIDETONE_NAMES = {0: "off", 1: "high", 2: "medium", 3: "low"}
#: Sidetone name (including the ``med`` shorthand) to id.
SIDETONE_VALUES = {"off": 0, "high": 1, "medium": 2, "med": 2, "low": 3}

#: Spatial audio mode id to name.
SPATIAL_NAMES = {0: "off", 1: "room", 2: "head"}

#: Audio source type id to name, as reported at ``[5.1]``.
SOURCE_TYPES = {0: "none", 1: "bluetooth", 2: "auxiliary"}

#: Voice prompt language id to name.
VOICE_LANGUAGES = {
    0: "UK English", 1: "US English", 2: "French", 3: "Italian", 4: "German",
    5: "EU Spanish", 6: "MX Spanish", 7: "BR Portuguese", 8: "Mandarin",
    9: "Korean", 10: "Russian", 11: "Polish", 12: "Hebrew", 13: "Turkish",
    14: "Dutch", 15: "Japanese", 16: "Cantonese", 17: "Arabic", 18: "Swedish",
    19: "Danish", 20: "Norwegian", 21: "Finnish", 22: "Hindi",
}

#: Voice prompt ids stored in a mode slot, keyed by their two payload bytes.
PROMPTS = {
    (0, 0): "NONE", (0, 1): "QUIET", (0, 2): "AWARE", (0, 3): "TRANSPARENT",
    (0, 4): "TRANSPARENCY", (0, 5): "MASKING", (0, 6): "COMFORT",
    (0, 7): "COMMUTE", (0, 8): "OUTDOOR", (0, 9): "WORKOUT", (0, 10): "HOME",
    (0, 11): "WORK", (0, 12): "MUSIC", (0, 13): "FOCUS", (0, 14): "RELAX",
    (0, 15): "FLIGHT", (0, 16): "AIRPORT", (0, 17): "DRIVING",
    (0, 18): "TRAINING", (0, 19): "GYM", (0, 20): "RUN", (0, 21): "WALK",
    (0, 22): "HIKE", (0, 23): "TALK", (0, 24): "CALL", (0, 25): "WHISPER",
    (0, 26): "HEARING", (0, 27): "LEARN", (0, 28): "PODCAST",
    (0, 29): "AUDIOBOOK", (0, 30): "CALM", (0, 31): "SLEEP",
    (0, 32): "MEDITATE", (0, 33): "YOGA", (0, 34): "IMMERSION",
    (0, 35): "STEREO", (0, 36): "CINEMA",
}

#: Physical button id to name.
BUTTON_IDS = {
    0: "DistalCnc", 1: "Reserved", 2: "Vpa", 3: "RightShortcut",
    4: "LeftShortcut", 16: "Action", 128: "Shortcut",
}

#: Button gesture id to name.
BUTTON_EVENTS = {
    0: "reserved", 1: "rising_edge", 2: "falling_edge", 3: "short_press",
    4: "single_press", 5: "press_and_hold", 6: "double_press",
    7: "double_press_hold", 8: "triple_press", 9: "long_press",
    10: "very_long_press", 11: "very_very_long_press",
    12: "very_very_very_long_press",
}

#: What a button gesture can be made to do.
ACTION_MODES = {
    0: "NotConfigured", 1: "VPA", 2: "ANC", 3: "BatteryLevel",
    4: "PlayPause", 5: "IncreaseCNC", 6: "DecreaseCNC", 7: "ToggleWakeWord",
    8: "SwitchDevice", 9: "ConversationMode", 10: "TrackForward",
    11: "TrackBack", 12: "FetchNotifications", 13: "WindMode", 14: "Disabled",
    15: "ClientInteraction", 16: "SpotifyGo", 17: "ModesCarousel",
    19: "SpatialAudioMode", 20: "LineInSwitch", 21: "Linking",
}

#: AudioControlValue, from the Bose app's own enum. A device advertises which
#: of these it supports as a bitmap in GET ``[5.3]``.
TRANSPORT_CONTROLS = {
    "stop": 0x00, "play": 0x01, "pause": 0x02,
    "next": 0x03, "prev": 0x04,
    "ff_press": 0x05, "ff_release": 0x06,
    "rewind_press": 0x07, "rewind_release": 0x08,
}

#: Lower-case button name to id, for arguments typed on the command line.
BUTTON_BY_NAME = {v.lower(): k for k, v in BUTTON_IDS.items()}
#: Lower-case gesture name to id.
EVENT_BY_NAME = {v.lower(): k for k, v in BUTTON_EVENTS.items()}
#: Lower-case action name to id.
ACTION_BY_NAME = {v.lower(): k for k, v in ACTION_MODES.items()}


def signed(value):
    """A payload byte read as a signed 8-bit number."""
    return value if value < 128 else value - 256


def resolve(value, table, kind):
    """Accept either a numeric id or its name from *table*.

    :param value: an ``int`` (passed through) or a case-insensitive name.
    :param table: one of the ``*_BY_NAME`` maps above.
    :param kind: what is being resolved, for the error message.
    :raises ValueError: when the name is not in *table*.
    """
    if not isinstance(value, str):
        return value
    resolved = table.get(value.lower())
    if resolved is None:
        raise ValueError("Unknown %s: %s (valid: %s)"
                         % (kind, value, ", ".join(sorted(table))))
    return resolved
