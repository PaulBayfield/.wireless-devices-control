"""bose -- one command line for Bose devices that speak BMAP.

    uv run main.py                    status of whatever is connected
    uv run main.py eq 3 0 -2          bass +3, mid flat, treble -2
    uv run main.py --device qc45 quiet
    uv run main.py probe --mac ...    map an unknown device, read-only
    uv run main.py replay sweep.json  check a model against a recording

No dependencies, no account, no Bose app: it opens an RFCOMM socket to the
device and speaks BMAP, the protocol the app itself uses.

The command set adapts to what answered: shared commands appear only for a
model that has the feature behind them, and each device class adds its own
on top. See src.devices for how to add a model.
"""

import sys

from .. import devices, transport
from ..output import BOLD, DIM, RED, RESET
from ..protocol.errors import BmapError
from . import registry
from .offline import NO_DEVICE
from .shared import cmd_status

#: The defaults every run starts from, before the flags are read.
DEFAULT_OPTIONS = {"mac": None, "key": None, "channel": None, "timeout": 3.0}


def parse_args(argv):
    """Pull the global options off the front of *argv*.

    :returns: ``(options, command, args)``, with ``status`` as the command
        when none was given.
    :raises SystemExit: on an unknown flag, a flag with no value, or an
        unknown ``--device``.
    """
    options = dict(DEFAULT_OPTIONS)
    rest = list(argv)
    while rest and rest[0].startswith("--"):
        flag = rest.pop(0)
        if flag in ("--help", "-h"):
            return options, "help", []
        if not rest:
            raise SystemExit("%s needs a value" % flag)
        value = rest.pop(0)
        if flag == "--mac":
            options["mac"] = value
        elif flag == "--device":
            if devices.for_key(value) is None:
                raise SystemExit("Unknown device '%s'. Known: %s"
                                 % (value, ", ".join(devices.keys())))
            options["key"] = value
        elif flag == "--channel":
            options["channel"] = int(value)
        elif flag == "--timeout":
            options["timeout"] = float(value)
        else:
            raise SystemExit("Unknown option: %s" % flag)

    command = rest.pop(0).lower() if rest else "status"
    return options, command, rest


def status_everything(options):
    """Run ``status`` against every connected device, one after another.

    Each device is its own RFCOMM session, so one that has gone quiet is
    reported in place and the rest still print.
    """
    for shown, found in enumerate(transport.connected_devices()):
        mac, name, device_class, _connected = found
        if shown:
            print()
        print("%s%s%s %s(%s)%s" % (BOLD, name or device_class.NAME, RESET,
                                   DIM, device_class.KEY, RESET))
        try:
            with transport.connect(mac=mac, key=device_class.KEY,
                                   channel=options["channel"],
                                   timeout=options["timeout"]) as dev:
                cmd_status(dev, [])
        except BmapError as e:
            print("  %sunreachable:%s %s" % (RED, RESET, e))
    return 0


def main(argv=None):
    """Parse, dispatch, and turn any BMAP failure into an exit code.

    :returns: 0 on success, 1 on a device or link failure, 2 when the model
        has no such command.
    """
    options, command, args = parse_args(sys.argv[1:] if argv is None else argv)

    if command in NO_DEVICE:
        NO_DEVICE[command](args)
        return 0

    # `probe` and `replay` take their own flags, so they get the rest of the
    # line untouched -- `main.py probe --mac ...`, not `main.py --mac ... probe`.
    if command in registry.TOOL_COMMANDS:
        return registry.run_tool(command, args)

    # `status` reads and changes nothing, so with nothing singled out it
    # covers every connected device rather than making you pick one.
    if command == "status" and not options["mac"] and not options["key"]:
        if len(transport.connected_devices()) > 1:
            return status_everything(options)

    try:
        dev = transport.connect(mac=options["mac"], key=options["key"],
                                channel=options["channel"],
                                timeout=options["timeout"])
    except BmapError as e:
        print("%sError:%s %s" % (RED, RESET, e), file=sys.stderr)
        return 1

    available = registry.commands_for(type(dev))
    handler = available.get(command)
    if handler is None:
        print("%sError:%s %s has no '%s' command.\n  It offers: %s"
              % (RED, RESET, dev.NAME, command, ", ".join(sorted(available))),
              file=sys.stderr)
        dev.close()
        return 2

    # `pause` and friends are spellings of `control` that pass their own name.
    if command in registry.SELF_NAMED:
        args = [command]

    try:
        with dev:
            handler(dev, args)
    except (BmapError, ValueError) as e:
        print("%sError:%s %s" % (RED, RESET, e), file=sys.stderr)
        return 1
    return 0


def run():
    """Console-script entry point: run :func:`main` and exit with its code."""
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
