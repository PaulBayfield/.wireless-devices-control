"""Which commands a given model offers.

The CLI never hard-codes a command list. It asks here, and the answer is
built from the model's own feature table: a shared command appears only when
the device declares the feature behind it, and the model's own commands are
merged on top. A model that cannot do something therefore has no word for
it, rather than a word that fails.
"""

from . import shared

#: ``command name -> (handler, the feature it needs)``. A feature of ``None``
#: means the command works on anything that answered at all.
SHARED_COMMANDS = {
    "status": (shared.cmd_status, None),
    "info": (shared.cmd_info, None),
    "battery": (shared.cmd_battery, "battery"),
    "volume": (shared.cmd_volume, "volume"),
    "source": (shared.cmd_source, "source"),
    "control": (shared.cmd_control, "transport_control"),
    "name": (shared.cmd_name, "product_name"),
    "eq": (shared.cmd_eq, "eq"),
    "standby": (shared.cmd_standby, "standby"),
    "multipoint": (shared.cmd_multipoint, "multipoint"),
    "prompts": (shared.cmd_prompts, "voice_prompts"),
    "buttons": (shared.cmd_buttons, "buttons"),
    "paired": (shared.cmd_paired, "device_list"),
    "pair": (shared.cmd_pair, "pairing"),
    "off": (shared.cmd_off, "power"),
    "raw": (shared.cmd_raw, None),
}

#: The order ``help`` lists them in: what you want most, first.
SHARED_ORDER = ("status", "info", "battery", "volume", "source", "control",
                "name", "eq", "standby", "multipoint", "prompts", "buttons",
                "paired", "pair", "off", "raw")

#: Spellings of ``control`` that pass their own name as the argument, so
#: ``pause`` means ``control pause``. Available wherever ``control`` is.
SELF_NAMED = ("play", "pause", "stop", "next", "prev")

#: The two tools, which take their own flags and never open a device the way
#: an ordinary command does. Each hands off to a ``main(argv)`` in
#: :mod:`src.devices.bose.tools` and returns its exit code.
TOOL_COMMANDS = {
    "probe": "Sweep an unknown device read-only, to map a new model.",
    "replay": "Run a device class against a recorded sweep, with no hardware.",
}


def run_tool(name, args):
    """Hand *args* to one of :data:`TOOL_COMMANDS` and return its exit code.

    Imported here rather than at module scope so that an ordinary command
    never pays for loading the probe's channel tables.
    """
    from src.devices.bose.tools import probe, replay

    return {"probe": probe.main, "replay": replay.main}[name](args)


def commands_for(device_class):
    """Every command a model offers: the shared ones it can do, plus its own.

    :param device_class: a :class:`~src.devices.bose.models.base.Device` subclass.
    :returns: ``{name: handler}``. On a name clash the model's own wins.
    """
    available = {}
    for name in SHARED_ORDER:
        handler, feature = SHARED_COMMANDS[name]
        if feature is None or feature in device_class.FEATURES:
            available[name] = handler
    if "transport_control" in device_class.FEATURES:
        for alias in SELF_NAMED:
            available[alias] = shared.cmd_control
    available.update(device_class.COMMANDS)
    return available


def summary(handler):
    """The one-line description ``help`` prints for a handler."""
    doc = (handler.__doc__ or "").strip()
    return doc.splitlines()[0] if doc else ""
