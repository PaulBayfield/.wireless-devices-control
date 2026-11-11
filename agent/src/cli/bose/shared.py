"""The commands that are not particular to any model.

Each one names the feature it needs, and
:func:`~src.cli.bose.registry.commands_for` then offers it only to a
device whose class declares that feature. That is why the same ``volume``
works on a speaker and a pair of headphones, while ``cnc`` appears on
neither unless its class says so.

Handlers take ``(device, args)``, print, and return nothing. Their first
docstring line is what ``help`` prints, so it is written to be read there.
"""

from src.core.output import CYAN, DIM, RESET, as_bool, on_off, row, status_row
from src.devices.bose.protocol import codec


def cmd_status(dev, args):
    """Everything this device will tell us. Reads only."""
    for label, value in dev.status_rows():
        status_row(label, value)


def cmd_info(dev, args):
    """Identity: model, serial, addresses, firmware, platform."""
    row("Model", dev.safe(dev.model, dev.NAME), CYAN)
    row("Codename", dev.CODENAME)
    row("Platform", dev.PLATFORM)
    product_id, variant = dev.safe(dev.product_id, (None, None))
    if product_id is not None:
        row("Product ID", "0x%04X%s"
            % (product_id, " variant %d" % variant if variant is not None else ""))
    row("Firmware", dev.safe(dev.firmware, ""), DIM)
    row("Serial", dev.safe(dev.serial, ""), DIM)
    row("MAC", dev.safe(dev.mac, ""), DIM)
    row("Channel", "RFCOMM %d" % dev.CHANNEL, DIM)
    active = dev.safe(dev.active_device)
    if active:
        row("Connected to", active, CYAN)


def cmd_battery(dev, args):
    """Charge percentage on its own, for scripts and status bars."""
    print("%d" % dev.battery().percent)


def cmd_volume(dev, args):
    """Show or set the volume: a level, or a relative step like +3 or -2."""
    if not args:
        level, steps = dev.volume()
        print("unknown" if level is None else "%d/%d" % (level, steps))
        return

    words = [a for a in args if a.lower() != "--loud"]
    force = len(words) != len(args)
    word = words[0] if words else "up"
    if word.lower() in ("up", "down"):
        word = "+1" if word.lower() == "up" else "-1"

    if word[0] in "+-":
        level = dev.nudge_volume(int(word), force=force)
    else:
        level = dev.set_volume(int(word), force=force)
    _level, steps = dev.volume()
    print("Volume %d/%d%s"
          % (level, steps,
             "" if force else "  (ceiling %d)" % dev.SAFE_MAX_VOLUME))


def cmd_source(dev, args):
    """Which input is playing, and from which device."""
    playing = dev.source()
    print("%s%s" % (playing.kind,
                    " from %s" % playing.mac if playing.mac else ""))


def cmd_control(dev, args):
    """Transport control: play, pause, stop, next, prev, and more."""
    if not args:
        print("This device accepts: %s" % ", ".join(dev.transport_controls()))
        return
    action = args[0].lower()
    dev.control(action)
    print(action)


def cmd_name(dev, args):
    """Show the Bluetooth name, or rename the device."""
    if not args:
        print(dev.name())
        return
    new_name = " ".join(args)
    dev.set_name(new_name)
    print("Renamed to %s" % new_name)


def cmd_eq(dev, args):
    """Read the EQ bands, or set them: eq <bass> <mid> <treble>."""
    if not args:
        for band in dev.eq():
            row(band.name, "%+d  (%d..%+d)"
                % (band.current, band.min_val, band.max_val))
        return
    if len(args) != 3:
        raise SystemExit("eq takes three values: bass mid treble")
    values = [int(a) for a in args]
    dev.set_eq(*values)
    print("EQ %+d/%+d/%+d" % tuple(values))


def cmd_standby(dev, args):
    """Show or set the auto-off timer, in minutes."""
    if not args:
        minutes = dev.standby_minutes()
        print("unknown" if minutes is None else "%d min" % minutes)
        return
    minutes = int(args[0])
    dev.set_standby_minutes(minutes)
    print("Auto-off %d min" % minutes)


def cmd_multipoint(dev, args):
    """Show or set two-device multipoint."""
    if not args:
        print(on_off(dev.multipoint()))
        return
    enabled = as_bool(args[0], "multipoint")
    dev.set_multipoint(enabled)
    print("Multipoint %s" % on_off(enabled))


def cmd_prompts(dev, args):
    """Show or set spoken voice prompts."""
    if not args:
        enabled, language = dev.prompts()
        print("%s (%s)" % (on_off(enabled), language))
        return
    enabled = as_bool(args[0], "prompts")
    dev.set_prompts(enabled)
    print("Voice prompts %s" % on_off(enabled))


def cmd_buttons(dev, args):
    """Show the button mapping, or remap: buttons <button> <event> <action>."""
    if not args:
        mapping = dev.buttons()
        if mapping is None:
            print("No button mapping reported.")
            return
        row("Button", mapping.button_name)
        row("Event", mapping.event_name)
        row("Action", mapping.action_name, CYAN)
        if mapping.supported_actions:
            row("Supported", ", ".join(mapping.supported_actions), DIM)
        return
    if len(args) != 3:
        raise SystemExit("buttons takes three values: button event action\n"
                         "e.g. buttons Action single_press ANC")
    mapping = dev.set_buttons(*args)
    print("%s %s -> %s" % (mapping.button_name, mapping.event_name,
                           mapping.action_name) if mapping else "Remapped")


def cmd_paired(dev, args):
    """List the devices this one remembers, marking the active one."""
    listing = dev.device_list()
    active = dev.safe(dev.active_device)
    if not listing.macs:
        print("No remembered devices reported.")
        return
    for mac in listing.macs:
        print("  %s%s" % (mac, "  %s(active)%s" % (CYAN, RESET)
                          if mac == active else ""))
    print("%s  leading byte %02x -- meaning unconfirmed%s"
          % (DIM, listing.lead_byte, RESET))


def cmd_pair(dev, args):
    """Enter pairing mode, or leave it with 'pair off'."""
    enabled = not (args and args[0].lower() in ("off", "false", "no", "0"))
    dev.set_pairing(enabled)
    print("Pairing mode %s" % on_off(enabled))


def cmd_off(dev, args):
    """Power the device off."""
    if dev.power_off():
        print("Powered off")
    else:
        print("The device did not acknowledge the power-off")


def cmd_raw(dev, args):
    """Send raw BMAP bytes and print every reply: raw 00 05 01 00."""
    if not args:
        raise SystemExit("raw takes hex bytes, e.g. raw 00 05 01 00")
    for resp in dev.raw("".join(args)):
        print("  %s" % codec.fmt(resp))
