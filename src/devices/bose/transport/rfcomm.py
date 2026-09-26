"""One RFCOMM session: connect, exchange packets, close.

Windows and Linux both reach RFCOMM through the same CPython socket API --
``AF_BLUETOOTH`` / ``BTPROTO_RFCOMM`` with a ``(mac, channel)`` address -- so
this class is shared and only discovery differs per platform.

macOS is not supported: its RFCOMM stack is only reachable through
IOBluetooth, which needs PyObjC.
"""

import socket
import time

from ..protocol import OP_GET
from ..protocol.errors import BmapConnectionError, BmapTimeoutError


class RfcommTransport:
    """A Bluetooth serial link to one device.

    :param mac: the device's address.
    :param channel: the RFCOMM channel to dial.
    :param timeout: the deadline for one exchange, in seconds.
    :param connect_timeout: the deadline for opening the socket. Defaults to
        at least ten seconds, because waking an idle device takes far longer
        than talking to one already connected.
    """

    # Bringing up an RFCOMM session is racy on Windows in a way it is not on
    # BlueZ. Two failure modes show up back to back, most often when a second
    # command follows a first: the channel from the previous session is still
    # reserved (WSAEADDRINUSE), or the new socket connects but the device
    # never answers the opening request. Both clear within a second or two,
    # so setup is retried rather than surfaced to the user.
    _SETUP_ATTEMPTS = 4
    _SETUP_BACKOFF = 1.0

    #: The firmware needs a beat between the request and the read.
    _REPLY_DELAY = 0.2

    #: How long to keep reading once a drained exchange has started.
    _DRAIN_TIMEOUT = 0.5

    #: Winsock errors worth explaining rather than echoing.
    _WSA_HINTS = {
        10064: "the device is powered off or out of range",
        10060: "the device did not answer in time",
        10061: "the device refused the connection on this channel",
        10050: "the Bluetooth adapter is off or unavailable",
        10022: "the device is not paired with this PC",
    }

    def __init__(self, mac, channel, timeout=3.0, connect_timeout=None):
        self.mac = mac
        self.channel = channel
        self.timeout = timeout
        self.connect_timeout = connect_timeout or max(timeout, 10.0)
        self._sock = None
        self._established = False

    def __repr__(self):
        return "<RfcommTransport %s channel %d>" % (self.mac, self.channel)

    # -- lifecycle -----------------------------------------------------------

    def connect(self):
        """Open the socket, retrying while Windows still holds the channel."""
        if not hasattr(socket, "AF_BLUETOOTH"):
            raise BmapConnectionError(
                "This Python build has no Bluetooth socket support "
                "(socket.AF_BLUETOOTH is missing). Run with a python.org "
                "build of Python 3.9 or newer, e.g. "
                "'uv run --python /path/to/python.exe __main__.py'."
            )
        last = None
        for _attempt in range(self._SETUP_ATTEMPTS):
            try:
                self._connect_once()
                return
            except BmapConnectionError as e:
                cause = e.__cause__
                if getattr(cause, "winerror", None) != 10048:
                    raise
                last = e  # channel still held by the previous session
                time.sleep(self._SETUP_BACKOFF)
        raise last

    def _connect_once(self):
        try:
            self._sock = socket.socket(
                socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM
            )
            self._sock.settimeout(self.connect_timeout)
            self._sock.connect((self.mac, self.channel))
            self._sock.settimeout(self.timeout)
        except TimeoutError as e:
            # Our own deadline, not the stack's: no winerror to look up.
            self._sock = None
            raise BmapConnectionError(
                "Timed out after %.0fs opening channel %d on %s -- the device "
                "did not wake up" % (self.connect_timeout, self.channel, self.mac)
            ) from e
        except OSError as e:
            self._sock = None
            hint = self._WSA_HINTS.get(getattr(e, "winerror", None))
            if hint:
                raise BmapConnectionError(
                    "Failed to connect to %s on channel %d: %s"
                    % (self.mac, self.channel, hint)) from e
            raise BmapConnectionError(
                "Failed to connect to %s: %s" % (self.mac, e)) from e

    def close(self):
        """Close the socket. Safe to call more than once."""
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        self._established = False

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *exc):
        self.close()

    # -- exchanges -----------------------------------------------------------

    def send_recv(self, data, drain=False):
        """Send one packet and read the answer.

        A silent *opening* exchange is retried with a fresh session, but only
        when it is a GET: replaying a write could apply a setting twice. Once
        the device has answered once the session is reliable, and every later
        exchange goes straight through.

        :param drain: keep reading after the first reply, for a GetAll that
            streams one packet per item.
        """
        if self._established or not self._is_get(data):
            return self._send_recv_once(data, drain)

        last = None
        for attempt in range(self._SETUP_ATTEMPTS):
            try:
                answer = self._send_recv_once(data, drain)
            except BmapTimeoutError as e:
                last = e
                if attempt == self._SETUP_ATTEMPTS - 1:
                    break
                self.close()
                time.sleep(self._SETUP_BACKOFF)
                self.connect()
                continue
            self._established = True
            return answer
        raise last

    def _send_recv_once(self, data, drain):
        if not self._sock:
            raise BmapConnectionError("Not connected")
        try:
            self._sock.send(data)
            time.sleep(self._REPLY_DELAY)
            answer = self._sock.recv(4096)
        except TimeoutError:
            raise BmapTimeoutError("No response from the device") from None
        except OSError as e:
            raise BmapConnectionError("Communication error: %s" % e) from e

        if drain:
            self._sock.settimeout(self._DRAIN_TIMEOUT)
            try:
                while True:
                    more = self._sock.recv(4096)
                    if not more:
                        break
                    answer += more
            except (TimeoutError, BlockingIOError):
                pass
            self._sock.settimeout(self.timeout)

        return answer

    @staticmethod
    def _is_get(data):
        """Whether a packet is a GET, and so safe to send twice."""
        # The flags byte carries the operator in its low nibble.
        return len(data) >= 3 and (data[2] & 0x0F) == OP_GET
