"""The wire format: operators, the packet codec, and debug rendering.

BMAP is Bose's own messaging protocol, spoken over a plain Bluetooth RFCOMM
socket. A packet is four header bytes followed by a payload::

    [fblock_id, function_id, flags, payload_length, ...payload]

``flags`` carries the operator in its low nibble. SET (0) is gated behind
cloud-mediated authentication, but GET (1), SETGET (2) and START (5) are
accepted unauthenticated on the Settings, Control and AudioModes blocks --
which is everything a user-facing setting needs.

Nothing here knows about any particular device: addresses and layouts live
in :mod:`src.devices.bose.models`, the socket in :mod:`src.devices.bose.transport`.
"""

from collections import namedtuple

#: Write. Authentication required, so nothing in this package sends one.
OP_SET = 0
#: Read.
OP_GET = 1
#: Write and read back the result.
OP_SETGET = 2
#: A state notification from the device.
OP_STATUS = 3
#: An error response.
OP_ERROR = 4
#: Trigger an action.
OP_START = 5
#: The action completed.
OP_RESULT = 6
#: The action was accepted and will be applied asynchronously.
OP_PROCESSING = 7

#: Operator id to name, for debug output.
OP_NAMES = {
    0: "SET", 1: "GET", 2: "SETGET", 3: "STATUS",
    4: "ERROR", 5: "START", 6: "RESULT", 7: "PROCESSING",
}

#: The error byte a device sends in an ERROR packet's payload.
ERROR_NAMES = {
    0: "Unknown", 1: "Length", 2: "Chksum", 3: "FblockNotSupp",
    4: "FuncNotSupp", 5: "OpNotSupp(auth)", 6: "InvalidData",
    7: "DataUnavail", 8: "Runtime", 9: "Timeout", 10: "InvalidState",
    15: "InvalidTransition", 20: "InsecureTransport",
}

#: One decoded packet: the address it came from, its operator and its payload.
Response = namedtuple("Response", ["fblock", "func", "op", "payload"])


def packet(addr, operator, payload=b""):
    """Build a BMAP packet.

    :param addr: the ``(fblock, func)`` address to send to.
    :param operator: one of the ``OP_*`` constants.
    :param payload: the payload bytes, at most 255 of them.
    :returns: the encoded packet.
    """
    fblock, func = addr
    return bytes([fblock, func, operator & 0x0F, len(payload)]) + payload


def parse(data):
    """Parse the first BMAP response in *data*, or ``None`` if it is too short."""
    responses = parse_all(data, limit=1)
    return responses[0] if responses else None


def parse_all(data, limit=None):
    """Split concatenated BMAP responses into a list of :data:`Response`.

    A device answers a GetAll with one STATUS packet per item, all arriving
    in a single read, so each packet's length byte is what separates them.
    A truncated tail is dropped rather than guessed at.
    """
    out = []
    pos = 0
    while pos + 4 <= len(data):
        length = data[pos + 3]
        if pos + 4 + length > len(data):
            break  # truncated tail
        out.append(Response(
            data[pos], data[pos + 1], data[pos + 2] & 0x0F,
            data[pos + 4:pos + 4 + length],
        ))
        pos += 4 + length
        if limit is not None and len(out) >= limit:
            break
    return out


def fmt(resp):
    """Render a response for debug output, e.g. ``'[1.5] STATUS: 0b00'``."""
    name = OP_NAMES.get(resp.op, "op%d" % resp.op)
    if resp.op == OP_ERROR and resp.payload:
        err = ERROR_NAMES.get(resp.payload[0], "err%d" % resp.payload[0])
        return "[%d.%d] %s: %s (%s)" % (resp.fblock, resp.func, name, err,
                                        resp.payload.hex())
    return "[%d.%d] %s: %s" % (resp.fblock, resp.func, name, resp.payload.hex())
