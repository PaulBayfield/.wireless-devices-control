"""Wireless Devices Control -- the debugging command line.

    uv run __main__.py                  battery of every device (the default)
    uv run __main__.py battery --json   the same, as the server will see it
    uv run __main__.py devices          everything discovery finds, every vendor
    uv run __main__.py serve            start the HTTP API for the web frontend
    uv run __main__.py bose ...         Bose commands      ('bose help')
    uv run __main__.py logitech ...     Logitech commands  ('logitech --help')

The web frontend, through the API, is the real interface; this exercises the
same device layer from a terminal, so a protocol problem can be chased
without a browser.
"""

import json
import sys

from src.core.errors import DeviceError
from src.core.output import BOLD, DIM, GREEN, RED, RESET, battery_color
from src.devices import scan


def describe(found):
    """A found device as plain data, the shape ``--json`` prints."""
    return {"vendor": found.vendor, "key": found.key, "name": found.name,
            "address": found.address, "connected": found.connected}


def read_battery(found):
    """``(battery, error)`` for one device; both ``None`` when not connected."""
    if not found.connected:
        return None, None
    try:
        with found.open() as dev:
            return dev.battery(), None
    except DeviceError as e:
        return None, str(e)


def cmd_battery(args):
    """Battery of every connected device, across all vendors."""
    readings = [(found, *read_battery(found)) for found in scan()]

    if "--json" in args:
        print(json.dumps([
            describe(found) | {
                "battery": None if battery is None else {
                    "percent": battery.percent, "state": battery.state,
                    "charging": battery.charging,
                    "millivolts": battery.millivolts},
                "error": error}
            for found, battery, error in readings], indent=2))
        return 0
    if not readings:
        print("No supported device found.")
        return 0
    for found, battery, error in readings:
        label = "  %s%-38s%s %s%-9s%s" % (BOLD, found.name, RESET, DIM,
                                          found.key, RESET)
        if battery is not None:
            color = battery_color(battery.percent) if battery.percent is not None else ""
            print("%s %s%s%s" % (label, color, battery, RESET))
        elif error:
            print("%s %sunreachable:%s %s" % (label, RED, RESET, error))
        else:
            print("%s %snot connected%s" % (label, DIM, RESET))
    return 0


def cmd_devices(args):
    """Everything discovery finds, with the key and address to reach it by."""
    found_all = scan()
    if "--json" in args:
        print(json.dumps([describe(found) for found in found_all], indent=2))
        return 0
    if not found_all:
        print("No supported device found.")
        return 0
    for found in found_all:
        state = ("%sconnected%s" % (GREEN, RESET) if found.connected
                 else "%spaired%s" % (DIM, RESET))
        print("  %-9s %-8s %-38s %-22s %s" % (found.vendor, found.key,
                                              found.name, found.address, state))
    return 0


def cmd_serve(args):
    """Start the HTTP API, configured from .env (see .env.example)."""
    from src.api import serve

    serve()
    return 0


def cmd_bose(args):
    """Bose commands: status, volume, eq, cnc... ('bose help' lists them)."""
    from .bose.main import main

    return main(args)


def cmd_logitech(args):
    """Logitech commands: info, battery, dpi, rate, led... ('logitech --help')."""
    from .logitech import main

    return main(args)


def cmd_help(args):
    """Show this help."""
    print(__doc__.strip())
    print("\n%sCommands%s:" % (BOLD, RESET))
    for name, handler in COMMANDS.items():
        print("  %-10s %s" % (name, handler.__doc__.strip().splitlines()[0]))
    return 0


#: Command name to handler. Each takes the rest of the line, returns an exit code.
COMMANDS = {
    "battery": cmd_battery,
    "devices": cmd_devices,
    "serve": cmd_serve,
    "bose": cmd_bose,
    "logitech": cmd_logitech,
    "help": cmd_help,
}


def main(argv=None):
    """Dispatch on the first word; ``battery`` when there is none."""
    argv = sys.argv[1:] if argv is None else argv
    command, args = (argv[0].lower(), argv[1:]) if argv else ("battery", [])
    if command in ("-h", "--help"):
        command = "help"
    handler = COMMANDS.get(command)
    if handler is None:
        print("%sError:%s unknown command '%s'. Try: %s"
              % (RED, RESET, command, ", ".join(COMMANDS)), file=sys.stderr)
        return 2
    return handler(args)


def run():
    """Entry point: run :func:`main` and exit with its code."""
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
