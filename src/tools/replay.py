"""replay -- run a device class against a recorded probe sweep.

``bose-probe --json`` writes down every payload a device answered with. This
feeds those recordings back through the class that drives it, so the parsers,
the status screen and the feature gating can be checked without the hardware
being awake -- and against real bytes rather than invented ones.

    uv run main.py replay captures/qc45-probe.json
    uv run main.py replay captures/soundlink-micro2-probe.json status info

Only GET is served: a recording holds no writes, so anything that tries one
fails loudly rather than appearing to work.
"""

import json
import sys

from .. import devices
from ..cli import registry
from ..protocol import OP_ERROR, OP_GET, OP_NAMES, OP_STATUS, codec
from ..protocol.errors import BmapError, BmapTimeoutError


class RecordedLink:
    """A transport that answers from a probe recording instead of a socket.

    :param blocks: the ``blocks`` object from a capture file, keyed by
        block and function as strings.
    """

    #: How a recorded operator name maps back to an operator id.
    _OPS = {"STATUS": OP_STATUS, "ERROR": OP_ERROR}

    def __init__(self, blocks):
        self._replies = {}
        for block, funcs in blocks.items():
            for func, entry in funcs.items():
                self._replies[(int(block), int(func))] = entry

    def send_recv(self, data, drain=False):
        """Answer a GET from the recording, or explain why it cannot."""
        addr = (data[0], data[1])
        operator = data[2] & 0x0F
        if operator != OP_GET:
            # A recording has nothing to say about writes.
            raise BmapTimeoutError(
                "replay has only GETs recorded; [%d.%d] was asked for %s"
                % (addr[0], addr[1], OP_NAMES.get(operator, operator)))
        entry = self._replies.get(addr)
        if entry is None:
            raise BmapTimeoutError("nothing recorded for [%d.%d]" % addr)
        return codec.packet(addr, self._OPS.get(entry["op_name"], OP_STATUS),
                            bytes.fromhex(entry["payload"]))

    def close(self):
        """Nothing to close; here so a recording is a drop-in transport."""


def load(path):
    """Read a capture file and return ``(device class, device)``.

    :raises SystemExit: when no class in the registry claims that product id.
    """
    with open(path, encoding="utf-8") as handle:
        capture = json.load(handle)

    device_class = devices.for_product_id(capture["product_id"])
    if device_class is None:
        raise SystemExit(
            "No class for PID 0x%04X -- %s is unmapped."
            % (capture["product_id"], capture.get("name", "that device")))
    return capture, device_class(RecordedLink(capture["blocks"]))


def main(argv=None):
    """Run each named command against a recording and print the result."""
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        print(__doc__.strip())
        return 2

    path, wanted = argv[0], argv[1:] or ["status", "info"]
    capture, dev = load(path)
    print("%s  (%s, recorded on channel %s)\n"
          % (dev.NAME, capture.get("name", ""), capture["channel"]))

    available = registry.commands_for(type(dev))
    for command in wanted:
        handler = available.get(command)
        print("$ %s" % command)
        if handler is None:
            print("  not offered by this model")
            continue
        try:
            handler(dev, [])
        except BmapError as e:
            print("  unavailable from a recording: %s" % e)
        print()
    return 0


def run():
    """Console-script entry point."""
    sys.exit(main())


if __name__ == "__main__":
    run()
