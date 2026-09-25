"""The address book: every layout that more than one model shares.

This is the heart of keeping a device module short. Almost every address a
Bose device answers means the same thing on every other Bose device -- the
battery is at ``[2.2]``, the volume at ``[5.5]``, the name at ``[1.2]`` --
so the entry for each one is written once here and named, not repeated.

A feature entry is a plain dict:

``addr``
    the ``(fblock, func)`` address.
``parser``
    a function from :mod:`src.protocol.parsers`, run over the
    payload a GET returns. Optional: without one, reads hand back raw bytes.
``builder``
    a function from :mod:`src.protocol.builders`, turning arguments
    into a payload. A feature without a builder is read-only, and
    :meth:`~src.devices.base.Device.set` refuses it by name rather
    than sending bytes it cannot shape.

A model builds its own table with :func:`features`, naming only what it adds
to or differs from :data:`COMMON`.
"""

from ..protocol import builders, modes, parsers

# -- ProductInfo [0.x] -------------------------------------------------------

#: ``[0.3]`` product id and variant -- what the registry is keyed on.
PRODUCT_ID = {"addr": (0, 3), "parser": parsers.product_id}
#: ``[0.5]`` firmware version string. Also the address most firmware wants
#: to be asked for first, before it will answer anything else.
FIRMWARE = {"addr": (0, 5), "parser": parsers.text}
#: ``[0.6]`` the device's own Bluetooth address.
BT_MAC = {"addr": (0, 6), "parser": parsers.mac}
#: ``[0.7]`` serial number.
SERIAL = {"addr": (0, 7), "parser": parsers.text}
#: ``[0.15]`` the factory model string, where the device carries one.
MODEL = {"addr": (0, 15), "parser": parsers.text}

# -- Settings [1.x] ----------------------------------------------------------

#: ``[1.2]`` the Bluetooth name, writable.
PRODUCT_NAME = {"addr": (1, 2), "parser": parsers.flagged_name,
                "builder": builders.name}
#: ``[1.3]`` spoken voice prompts, and which language they are in.
VOICE_PROMPTS = {"addr": (1, 3), "parser": parsers.prompts,
                 "builder": builders.prompts}
#: ``[1.4]`` auto-off timer on a model with a one-byte field (a QC45).
STANDBY_8 = {"addr": (1, 4), "parser": parsers.standby,
             "builder": builders.standby8}
#: ``[1.4]`` auto-off timer on a model with a two-byte field (a Micro 2).
STANDBY_16 = {"addr": (1, 4), "parser": parsers.standby,
              "builder": builders.standby16}
#: ``[1.5]`` noise cancellation. Read-only everywhere: a SETGET here is
#: refused as authentication-gated, so the level is written through a mode
#: slot instead.
CNC = {"addr": (1, 5), "parser": parsers.cnc}
#: ``[1.7]`` the three EQ bands, each -10 to +10.
EQ = {"addr": (1, 7), "parser": parsers.eq, "builder": builders.eq_band}
#: ``[1.9]`` button mapping.
BUTTONS = {"addr": (1, 9), "parser": parsers.buttons,
           "builder": builders.buttons}
#: ``[1.10]`` two-device multipoint.
MULTIPOINT = {"addr": (1, 10), "parser": parsers.multipoint,
              "builder": builders.toggle}
#: ``[1.11]`` sidetone, on models that have a microphone.
SIDETONE = {"addr": (1, 11), "parser": parsers.sidetone,
            "builder": builders.sidetone}

# -- Status [2.x], DeviceManagement [4.x] ------------------------------------

#: ``[2.2]`` charge percentage.
BATTERY = {"addr": (2, 2), "parser": parsers.battery}
#: ``[4.4]`` the addresses this device remembers.
DEVICE_LIST = {"addr": (4, 4), "parser": parsers.device_list}
#: ``[4.8]`` pairing mode. Raw: one byte in, one byte out.
PAIRING = {"addr": (4, 8)}
#: ``[4.9]`` the address of the device currently connected to this one --
#: not its own, which is :data:`BT_MAC`.
ACTIVE_DEVICE = {"addr": (4, 9), "parser": parsers.mac}

# -- AudioManagement [5.x], Control [7.x] ------------------------------------

#: ``[5.1]`` the active input, and what it is playing from.
SOURCE = {"addr": (5, 1), "parser": parsers.source}
#: ``[5.3]`` play, pause, skip and friends. A GET returns the bitmap of
#: which of them the device accepts; a START sends one.
TRANSPORT_CONTROL = {"addr": (5, 3), "parser": parsers.transport_controls,
                     "builder": builders.transport_control}
#: ``[5.5]`` volume, as ``(level, steps)``.
VOLUME = {"addr": (5, 5), "parser": parsers.volume, "builder": builders.volume}
#: ``[7.4]`` power. A GET reads ``01`` while awake; a START with ``00``
#: powers the device down.
POWER = {"addr": (7, 4)}

# -- AudioModes [31.x], headphones only --------------------------------------

#: ``[31.1]`` START here and the device streams one ModeConfig per slot.
MODES_GET_ALL = {"addr": (31, 1)}
#: ``[31.3]`` the slot the device is in right now.
CURRENT_MODE = {"addr": (31, 3)}
#: ``[31.6]`` one whole mode slot: 47-byte STATUS, 39-byte SETGET.
MODE_CONFIG = {"addr": (31, 6), "parser": modes.parse_config,
               "builder": modes.build_config}


#: Everything every Bose device mapped so far answers the same way. A model
#: starts from this and adds only what it has on top -- which is why
#: :mod:`src.devices.micro2` declares no addresses at all.
COMMON = {
    "product_id": PRODUCT_ID,
    "firmware": FIRMWARE,
    "bt_mac": BT_MAC,
    "serial": SERIAL,
    "product_name": PRODUCT_NAME,
    "voice_prompts": VOICE_PROMPTS,
    "eq": EQ,
    "buttons": BUTTONS,
    "multipoint": MULTIPOINT,
    "battery": BATTERY,
    "device_list": DEVICE_LIST,
    "pairing": PAIRING,
    "active_device": ACTIVE_DEVICE,
    "source": SOURCE,
    "transport_control": TRANSPORT_CONTROL,
    "volume": VOLUME,
    "power": POWER,
}


def features(*bases, **extra):
    """Build a model's feature table from :data:`COMMON` plus what it adds.

    :param bases: extra tables to merge in before *extra*, for a family of
        models that shares more than :data:`COMMON` does. Later wins.
    :param extra: ``feature=entry`` pairs. An entry of ``None`` drops that
        feature, for a model that does not have one the others do.
    :returns: a fresh dict, so a model can never mutate another model's table.

    ::

        FEATURES = catalog.features(
            standby=catalog.STANDBY_8,
            cnc=catalog.CNC,
            sidetone=None,
        )
    """
    merged = dict(COMMON)
    for base in bases:
        merged.update(base)
    for feature, entry in extra.items():
        if entry is None:
            merged.pop(feature, None)
        else:
            merged[feature] = entry
    return merged
