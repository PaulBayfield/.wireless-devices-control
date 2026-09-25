"""Turning "a device is out there somewhere" into an open, ready device.

:func:`connect` is the one function most callers want: it finds a device,
opens the right RFCOMM channel, sends whatever opening GET the firmware
insists on, and hands back an instance of the class that drives that model.
Everything else here is a step of that, exposed for the tools that need to
do it by hand.
"""

import sys

from .. import devices
from ..protocol import OP_GET, OP_STATUS, codec
from ..protocol.errors import (
    BmapConnectionError,
    BmapError,
    BmapNotFoundError,
)
from . import discovery
from .rfcomm import RfcommTransport


def connect(mac=None, key=None, channel=None, timeout=3.0):
    """Connect to a supported device and return it, ready to use.

    With no arguments it finds a connected device the registry knows.

    :param mac: skip discovery and dial this address.
    :param key: pick a model by short name (``"qc45"``, ``"micro2"``) when
        several are about, or say what *mac* is.
    :param channel: force an RFCOMM channel instead of the model's own.
    :param timeout: the per-exchange deadline, in seconds.
    :returns: a :class:`~src.devices.base.Device` subclass instance.
    :raises ~src.protocol.errors.BmapNotFoundError: when nothing
        suitable is paired.
    :raises ~src.protocol.errors.BmapConnectionError: when no
        channel answers BMAP.
    """
    if sys.platform == "darwin":
        raise BmapConnectionError(
            "macOS is not supported: RFCOMM there needs IOBluetooth via "
            "PyObjC. Use the full pybmap library.")

    device_class = devices.for_key(key) if key else None
    if mac is None:
        mac, device_class = discover(device_class)
    elif device_class is None:
        device_class = discovery.class_for_mac(mac)
        if device_class is None:
            raise BmapNotFoundError(
                "%s is not a device this client knows. Pass --device with "
                "one of: %s" % (mac, ", ".join(devices.keys())))

    link = open_channel(mac, device_class, channel=channel, timeout=timeout)
    return device_class(link)


def discover(device_class=None):
    """Find a supported device, preferring a connected one over an idle one.

    :param device_class: narrow the search to one model.
    :returns: ``(mac, device class)``.
    """
    supported = discovery.supported_devices(device_class)
    live = [found for found in supported if found[3]]
    if len(live) == 1:
        return live[0][0], live[0][2]
    if len(live) > 1:
        raise BmapNotFoundError(
            "Several supported devices are connected -- choose one with "
            "--device:\n%s" % "\n".join(
                "  %-8s %s (%s)" % (found[2].KEY, found[1], found[0])
                for found in live))
    if supported:
        # Paired but idle: worth a try, it may wake when we dial it.
        return supported[0][0], supported[0][2]
    raise BmapNotFoundError(not_found_message(device_class))


def open_link(mac, channel, timeout=3.0, init_addr=None, connect_timeout=None):
    """Open one RFCOMM session on a known channel, with no probing.

    For callers that already know exactly what they are dialling, such as
    :mod:`src.tools.probe`. *init_addr* is the GET some firmware
    wants before it will answer anything else.
    """
    link = RfcommTransport(mac, channel=channel, timeout=timeout,
                           connect_timeout=connect_timeout)
    link.connect()
    if init_addr is not None:
        link.send_recv(codec.packet(init_addr, OP_GET))
    return link


def open_channel(mac, device_class, channel=None, timeout=3.0):
    """Connect on the model's own channel, then probe its fallbacks.

    A socket that accepts the connection is no proof of BMAP -- several
    channels accept and then stay silent -- so each fallback is confirmed
    with a firmware GET before it is handed back. The model's own channel is
    trusted without that check, which saves an exchange in the usual case.
    """
    init_addr = device_class.INIT_ADDR
    first = channel or device_class.CHANNEL
    candidates = [first] + [c for c in device_class.FALLBACK_CHANNELS
                            if c != first]

    first_error = None
    for position, candidate in enumerate(candidates):
        link = RfcommTransport(mac, channel=candidate, timeout=timeout)
        try:
            link.connect()
        except BmapConnectionError as e:
            first_error = first_error or e
            continue
        if position == 0:
            if init_addr is not None:
                link.send_recv(codec.packet(init_addr, OP_GET))
            return link
        if speaks_bmap(link, init_addr):
            return link
        link.close()

    tried = ", ".join(str(c) for c in candidates)
    idle = discovery.is_idle(mac)
    if idle:
        raise BmapConnectionError(
            "Windows lists %s as paired but not connected. Switch it on and "
            "wait for it to connect here -- if it is attached to your phone "
            "or another PC, disconnect it there first.\n"
            "  (tried channels %s -- last error: %s)"
            % (idle, tried, first_error))
    raise BmapConnectionError("No BMAP channel found on %s (tried %s): %s"
                              % (mac, tried, first_error))


def speaks_bmap(link, init_addr=None):
    """True when a firmware GET comes back as a real BMAP reply."""
    addr = init_addr or (0, 5)
    try:
        resp = codec.parse(link.send_recv(codec.packet(addr, OP_GET)))
    except BmapError:
        return False
    # Any 4-byte reply parses; a real BMAP peer echoes the address we asked.
    return (resp is not None and (resp.fblock, resp.func) == addr
            and resp.op == OP_STATUS)


def not_found_message(device_class=None):
    """The most useful thing that can be said when discovery finds nothing."""
    if device_class is not None:
        return "No paired %s found." % device_class.NAME
    unmapped = discovery.unmapped_devices()
    if unmapped:
        return (
            "No supported device found. These Bose devices are paired but "
            "have no module yet: %s. Map one with 'uv run main.py probe --mac "
            "<address>' and add it to src/devices/."
            % ", ".join("%s (PID 0x%04X)" % (name, product_id)
                        for _mac, name, product_id, _connected in unmapped))
    if sys.platform == "win32":
        return ("No paired Bose device found. Pair and connect it in "
                "Settings > Bluetooth & devices, or pass --mac.")
    return ("No paired Bose device found. Pair and connect it with "
            "bluetoothctl, or pass --mac.")
