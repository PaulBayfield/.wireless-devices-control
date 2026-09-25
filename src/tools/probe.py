"""probe -- map an unknown BMAP device by asking it what it supports.

This is the read-only half of reverse engineering: it opens an RFCOMM
channel, then walks the function blocks sending GET (operator 1) and records
what comes back. GET is never authentication-gated on any Bose device seen so
far, and it changes nothing -- no SETGET, no START, no writes of any kind.

    uv run main.py probe                        find a Bose device and sweep it
    uv run main.py probe --mac E4:58:BC:C5:2B:29
    uv run main.py probe --channels-only        just find the control channel
    uv run main.py probe --json micro2.json     save the raw findings

A block that answers FblockNotSupp to function 0 is skipped whole, which is
what keeps the sweep to a couple of minutes rather than twenty.
"""

import json
import sys
import time

from .. import devices, transport
from ..protocol import OP_GET, codec
from ..protocol.errors import (
    BmapConnectionError,
    BmapError,
    BmapTimeoutError,
)
from .reference import BLOCK_RANGE, CHANNEL_RANGE, FUNC_RANGE, KNOWN_BLOCKS, KNOWN_FUNCS

#: Error codes that mean "do not bother asking further here".
_ABSENT = (3, 4)  # FblockNotSupp, FuncNotSupp


def printable(payload):
    """Render a payload as text when it plausibly is text, else ``''``."""
    if not payload:
        return ""
    text = payload.split(b"\x00", 1)[0]
    if len(text) >= 2 and all(32 <= b < 127 for b in text):
        return text.decode("ascii")
    return ""


# -- Channel discovery -------------------------------------------------------

def find_channel(mac, timeout=2.0, verbose=True):
    """Find the RFCOMM channel that answers BMAP.

    Connecting proves nothing on its own -- several channels accept and then
    stay silent -- so each one is asked for its firmware version and has to
    answer with a well-formed reply to the address that was asked.

    :returns: ``(channel, open link)``, or ``(None, None)``.
    """
    for channel in CHANNEL_RANGE:
        # A sweep of 30 channels keeps the short deadline: this is for a
        # device that is already connected, not one being woken up.
        link = transport.RfcommTransport(mac, channel=channel, timeout=timeout,
                                         connect_timeout=timeout)
        try:
            link.connect()
        except BmapConnectionError as e:
            cause = getattr(e.__cause__, "winerror", None)
            if verbose and cause not in (10061, 10049, None):
                print("  channel %-2d  %s" % (channel, e))
            continue

        link._established = True  # a probe should never retry a silent GET
        try:
            resp = codec.parse(link.send_recv(codec.packet((0, 5), OP_GET)))
        except BmapError:
            resp = None
        if resp is not None and (resp.fblock, resp.func) == (0, 5):
            print("  channel %-2d  BMAP: %s" % (channel, codec.fmt(resp)))
            return channel, link
        link.close()
        if verbose:
            print("  channel %-2d  connected, no BMAP" % channel)
    return None, None


# -- Block sweep -------------------------------------------------------------

def sweep(link, blocks=BLOCK_RANGE, funcs=FUNC_RANGE):
    """GET every function of every live block.

    :returns: ``{block: {function: entry}}``, the same shape
        :mod:`src.tools.replay` reads back.
    """
    found = {}
    for block in blocks:
        # Function 0 is FblockInfo on every device seen. A FblockNotSupp here
        # means the whole block is absent, so the other 31 asks are skipped.
        first = ask(link, block, 0)
        if first is None or first.get("error") == 3:
            continue

        label = KNOWN_BLOCKS.get(block, "")
        print("\n  block %-2d %s"
              % (block, ("(%s on QC Ultra 2)" % label) if label else ""))
        entries = {0: first}
        report(block, 0, first)

        for func in funcs:
            if func == 0:
                continue
            entry = ask(link, block, func)
            if entry is None or entry.get("error") in _ABSENT:
                continue
            entries[func] = entry
            report(block, func, entry)
        found[block] = entries
    return found


def ask(link, block, func):
    """Send one GET and classify the answer. Never writes anything.

    :returns: an entry dict, or ``None`` when the device stayed silent.
    """
    try:
        resp = codec.parse(link.send_recv(codec.packet((block, func), OP_GET)))
    except BmapTimeoutError:
        return None  # silent: the function is there or not, it will not say
    except BmapConnectionError as e:
        raise SystemExit("Link lost at [%d.%d]: %s" % (block, func, e)) from e
    if resp is None:
        return None
    entry = {"op": resp.op,
             "op_name": codec.OP_NAMES.get(resp.op, str(resp.op)),
             "payload": resp.payload.hex()}
    if resp.op == codec.OP_ERROR and resp.payload:
        entry["error"] = resp.payload[0]
        entry["error_name"] = codec.ERROR_NAMES.get(resp.payload[0],
                                                    "err%d" % resp.payload[0])
    text = printable(resp.payload)
    if text:
        entry["text"] = text
    return entry


def report(block, func, entry):
    """Print one swept address, with whatever hint is known for it."""
    hint = KNOWN_FUNCS.get((block, func), "")
    detail = entry.get("text") or entry.get("error_name") or ""
    print("    [%2d.%-2d] %-10s %-32s %-22s %s"
          % (block, func, entry["op_name"], entry["payload"][:32],
             detail, hint))


def save(path, mac, name, product_id, channel, findings):
    """Write a sweep to JSON, in the shape ``main.py replay`` reads."""
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"mac": mac, "name": name, "product_id": product_id,
                   "channel": channel,
                   "blocks": {str(b): {str(f): e for f, e in fs.items()}
                              for b, fs in findings.items()}},
                  handle, indent=2)


# -- Entry point -------------------------------------------------------------

def pick_device(mac):
    """Resolve which paired Bose device to probe.

    :returns: ``(mac, name, product_id)``.
    :raises SystemExit: when nothing is paired, or several are and none was
        named.
    """
    paired = transport.bose_devices()
    if mac:
        for found_mac, name, product_id, _connected in paired:
            if found_mac.upper() == mac.upper():
                return found_mac, name, product_id
        return mac, "(not in the paired list)", None
    connected = [found for found in paired if found[3]]
    if len(connected) == 1:
        return connected[0][0], connected[0][1], connected[0][2]
    if not paired:
        raise SystemExit("No paired Bose devices found.")
    print("Several Bose devices are paired -- choose one with --mac:")
    for found_mac, name, product_id, is_connected in paired:
        print("  %s  %-24s PID 0x%04X  %s"
              % (found_mac, name, product_id,
                 "connected" if is_connected else "paired"))
    raise SystemExit(1)


def parse_args(argv):
    """Read the probe's own flags. Returns a dict of settings."""
    options = {"mac": None, "json": None, "channels_only": False,
               "timeout": 1.5, "help": False}
    rest = list(argv)
    while rest:
        flag = rest.pop(0)
        if flag == "--mac":
            options["mac"] = rest.pop(0)
        elif flag == "--json":
            options["json"] = rest.pop(0)
        elif flag == "--timeout":
            options["timeout"] = float(rest.pop(0))
        elif flag == "--channels-only":
            options["channels_only"] = True
        elif flag in ("--help", "-h"):
            options["help"] = True
        else:
            raise SystemExit("Unknown option: %s" % flag)
    return options


def main(argv=None):
    """Sweep one device and print, and optionally save, what answered."""
    options = parse_args(sys.argv[1:] if argv is None else argv)
    if options["help"]:
        print(__doc__.strip())
        return 0

    mac, name, product_id = pick_device(options["mac"])
    device_class = devices.for_product_id(product_id) if product_id else None
    known = ("already supported as '%s'" % device_class.KEY if device_class
             else "no module yet -- this sweep is how one gets written")
    print("Probing %s  %s  PID %s  (%s)\n"
          % (mac, name, "0x%04X" % product_id if product_id else "unknown",
             known))

    print("Scanning RFCOMM channels for a BMAP responder:")
    channel, link = find_channel(mac, timeout=options["timeout"])
    if channel is None:
        print("\nNo channel answered BMAP. The speaker may not expose it, or "
              "Windows may not have its SDP record -- try re-pairing, or run "
              "this from Linux where any channel can be dialled.")
        return 1
    print("\nBMAP is on channel %d." % channel)

    if options["channels_only"]:
        link.close()
        return 0

    started = time.time()
    try:
        findings = sweep(link)
    finally:
        link.close()

    live = sum(len(entries) for entries in findings.values())
    print("\n%d responding functions across %d blocks, in %.0fs"
          % (live, len(findings), time.time() - started))
    if device_class is None:
        print("To drive this device, subclass Device in src/devices/, "
              "put the addresses above in its FEATURES table, and register "
              "it --\nsrc/devices/__init__.py has the four steps.")

    if options["json"]:
        save(options["json"], mac, name, product_id, channel, findings)
        print("Raw findings written to %s" % options["json"])
    return 0


def run():
    """Console-script entry point."""
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    run()
