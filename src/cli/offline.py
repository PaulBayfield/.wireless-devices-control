"""The commands that need no device on the other end.

``devices`` and ``nowplaying`` read this machine rather than any headphones,
so they answer instantly and work with everything asleep. ``help`` builds
itself from the registry, which means a newly added model appears in it
without anyone editing a help string.
"""

import sys

from .. import devices, media
from ..output import BOLD, DIM, GREEN, RESET, YELLOW, row
from . import registry


def cmd_devices(args):
    """List paired Bose devices and whether this client can drive them."""
    from ..transport import bose_devices

    found = bose_devices()
    if not found:
        print("No paired Bose devices found.")
        return
    for mac, name, product_id, connected in found:
        device_class = devices.for_product_id(product_id)
        support = ("%s%s%s" % (GREEN, device_class.KEY, RESET) if device_class
                   else "%sno module yet%s" % (YELLOW, RESET))
        state = ("%sconnected%s" % (GREEN, RESET) if connected
                 else "%spaired%s" % (DIM, RESET))
        print("  %s  %-24s PID 0x%04X  %-22s %s"
              % (mac, name, product_id, support, state))


def cmd_nowplaying(args):
    """What is playing on this PC, and which devices are hearing it.

    BMAP carries no track metadata -- a device will only say which address
    it is playing *from*. When that address is this PC, Windows knows the
    track, so this reads it there and names the devices attached right now.
    It needs no connection to any of them.
    """
    from ..transport import connected_devices

    local = None
    if sys.platform == "win32":
        from ..transport import windows

        local = windows.radio_address()

    try:
        track = media.now_playing()
    except media.MediaUnavailable as e:
        print("Nothing to report: %s" % e)
        return

    row("Title", track.get("title", ""), BOLD)
    row("Artist", track.get("artist", ""))
    if track.get("album"):
        row("Album", track["album"])
    row("State", track.get("state", ""))
    row("App", track.get("app", ""), DIM)
    row("Playing on", "this PC%s" % (" (%s)" % local if local else ""), DIM)

    listening = connected_devices()
    if listening:
        row("Hearing it", ", ".join(
            "%s (%s)" % (name or device_class.NAME, device_class.KEY)
            for _mac, name, device_class, _connected in listening), GREEN)
    else:
        row("Hearing it", "no Bose device is connected to this PC", DIM)


def cmd_help(args):
    """Show this help."""
    from .main import __doc__ as usage

    print(usage.strip())
    print("\n%sOptions%s (before the command):" % (BOLD, RESET))
    print("  --device <key>   pick a model when several are connected")
    print("  --mac <address>  skip discovery")
    print("  --channel <n>    force an RFCOMM channel")
    print("  --timeout <s>    for slow links")

    print("\n%sShared commands%s (those the model supports):" % (BOLD, RESET))
    for name in registry.SHARED_ORDER:
        handler, _feature = registry.SHARED_COMMANDS[name]
        print("  %-11s %s" % (name, registry.summary(handler)))
    print("  %-11s spellings of 'control' that need no argument"
          % ", ".join(registry.SELF_NAMED))

    print("\n%sNo device needed%s:" % (BOLD, RESET))
    for name in ("devices", "nowplaying", "help"):
        print("  %-11s %s" % (name, registry.summary(NO_DEVICE[name])))
    for name in sorted(registry.TOOL_COMMANDS):
        print("  %-11s %s  (takes its own flags: '%s --help')"
              % (name, registry.TOOL_COMMANDS[name], name))

    for device_class in devices.all_devices():
        if not device_class.COMMANDS:
            continue
        print("\n%s%s%s (--device %s):"
              % (BOLD, device_class.NAME, RESET, device_class.KEY))
        for name in sorted(device_class.COMMANDS):
            print("  %-11s %s"
                  % (name, registry.summary(device_class.COMMANDS[name])))

    print("\n  With no command at all, 'status' runs -- across every connected")
    print("  device when more than one is about. Other commands act on one")
    print("  device, so pick it with --device or --mac.")


#: Commands dispatched before any connection is attempted.
NO_DEVICE = {
    "devices": cmd_devices,
    "nowplaying": cmd_nowplaying,
    "help": cmd_help,
}
