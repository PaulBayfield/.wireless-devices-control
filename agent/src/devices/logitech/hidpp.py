"""Minimal Logitech HID++ 2.0 client over a Lightspeed/Unifying receiver (hidapi)."""

import time

import hid

from src.core.errors import DeviceError

LOGITECH_VID = 0x046D
SHORT, LONG = 0x10, 0x11
SHORT_LEN, LONG_LEN = 7, 20
SW_ID = 0x0B  # arbitrary non-zero software id, lets us match our own replies
# How long to wait on the second try, for a device the first one woke.
WAKE_TIMEOUT = 2.0

# Well-known HID++ 2.0 feature ids
FEATURES = {
    0x0000: "ROOT",
    0x0001: "FEATURE_SET",
    0x0003: "DEVICE_FW_VERSION",
    0x0005: "DEVICE_NAME",
    0x1000: "BATTERY_STATUS",
    0x1001: "BATTERY_VOLTAGE",
    0x1004: "UNIFIED_BATTERY",
    0x1D4B: "WIRELESS_DEVICE_STATUS",
    0x1B04: "REPROG_CONTROLS_V4",
    0x2201: "ADJUSTABLE_DPI",
    0x2202: "EXTENDED_ADJUSTABLE_DPI",
    0x8060: "REPORT_RATE",
    0x8061: "EXTENDED_REPORT_RATE",
    0x8070: "COLOR_LED_EFFECTS",
    0x8071: "RGB_EFFECTS",
    0x8100: "ONBOARD_PROFILES",
    0x8110: "MOUSE_BUTTON_SPY",
}


#: HID++ 2.0 error codes, as the device returns them.
ERRORS = {
    0x01: "unknown", 0x02: "invalid argument", 0x03: "out of range",
    0x04: "hardware error", 0x05: "internal error", 0x06: "invalid feature index",
    0x07: "invalid function", 0x08: "busy", 0x09: "unsupported",
}


class HidppError(DeviceError):
    """Base for every HID++ failure."""


class HidppTimeout(HidppError):
    """The device did not answer in time -- usually off, or asleep."""


def find_receiver_paths(pid: int | None = None) -> tuple[bytes, bytes]:
    """Return (short_path, long_path) for the HID++ vendor collections."""
    short = long_ = None
    for d in hid.enumerate(LOGITECH_VID):
        if pid and d["product_id"] != pid:
            continue
        if d["usage_page"] != 0xFF00:
            continue
        if d["usage"] == 0x01:
            short = d["path"]
        elif d["usage"] == 0x02:
            long_ = d["path"]
    if not long_:
        raise HidppError("No Logitech HID++ interface found (is the receiver plugged in?)")
    return short, long_


def receiver_pids() -> list[int]:
    """Product ids of every plugged-in Logitech device with a HID++ interface."""
    return sorted({d["product_id"] for d in hid.enumerate(LOGITECH_VID)
                   if d["usage_page"] == 0xFF00 and d["usage"] == 0x02})


class HidppDevice:
    """A HID++ 2.0 device behind a receiver (device_index 1..6) or direct (0xFF)."""

    def __init__(self, device_index: int = 0x01, pid: int | None = None):
        self.index = device_index
        short_path, long_path = find_receiver_paths(pid)
        # On Windows each report size is its own HID collection. We send long
        # reports (always accepted by HID++ 2.0 devices) and read replies there.
        self.long = hid.device()
        self.long.open_path(long_path)
        self.short = None
        if short_path:
            self.short = hid.device()
            self.short.open_path(short_path)
            self.short.set_nonblocking(True)
        self._feature_cache: dict[int, int] = {}

    def close(self):
        self.long.close()
        if self.short:
            self.short.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # --- low level -------------------------------------------------------
    def _drain(self):
        self.long.set_nonblocking(True)
        while self.long.read(LONG_LEN):
            pass
        if self.short:
            while self.short.read(SHORT_LEN):
                pass
        self.long.set_nonblocking(False)

    def request(self, feat_index: int, function: int, params: bytes = b"", timeout: float = 1.0) -> bytes:
        """Send a HID++ 2.0 request and return the 16 byte payload of the reply.

        A sleeping device can drop the request that wakes it, so a ROOT
        request that times out is sent once more. ROOT only reads, and the
        first request on a fresh connection is always one -- a feature
        lookup -- so a retry never repeats a write.
        """
        try:
            return self._exchange(feat_index, function, params, timeout)
        except HidppTimeout:
            if feat_index != 0x00:
                raise
            return self._exchange(feat_index, function, params, WAKE_TIMEOUT)

    def _exchange(self, feat_index: int, function: int, params: bytes, timeout: float) -> bytes:
        """One request, one reply: no retries."""
        self._drain()
        func_sw = ((function & 0x0F) << 4) | SW_ID
        pkt = bytes([LONG, self.index, feat_index, func_sw]) + params
        pkt = pkt.ljust(LONG_LEN, b"\x00")
        self.long.write(pkt)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            # Short slices: HID++ 1.0 errors (empty slot, device asleep) come
            # back on the short collection, which is only read between waits.
            ms = max(1, min(20, int((deadline - time.monotonic()) * 1000)))
            r = self.long.read(LONG_LEN, ms)
            if not r and self.short:
                r = self.short.read(SHORT_LEN)
            if not r or r[1] != self.index:
                continue
            # HID++ 2.0 error: [0x11, idx, 0xFF, feat_index, func_sw, err]
            if r[2] == 0xFF and r[3] == feat_index and r[4] == func_sw:
                raise HidppError(
                    f"HID++ 2.0 error 0x{r[5]:02x}, {ERRORS.get(r[5], 'unknown')} "
                    f"(feature idx {feat_index}, fn {function})")
            # HID++ 1.0 error (e.g. device asleep/off): [0x10, idx, 0x8F, ...]
            if r[2] == 0x8F:
                raise HidppError(f"HID++ 1.0 error 0x{r[5]:02x} - device offline/asleep?")
            if r[2] == feat_index and r[3] == func_sw:
                return bytes(r[4:])
        raise HidppTimeout("Timed out waiting for reply (mouse off or asleep?)")

    # --- feature discovery ----------------------------------------------
    def feature_index(self, feature_id: int) -> int | None:
        if feature_id in self._feature_cache:
            return self._feature_cache[feature_id]
        r = self.request(0x00, 0, feature_id.to_bytes(2, "big"))
        idx = r[0] or None
        if feature_id == 0x0000:
            idx = 0
        self._feature_cache[feature_id] = idx
        return idx

    def protocol_version(self, timeout: float = 1.0) -> tuple[int, int]:
        r = self.request(0x00, 1, b"\x00\x00\xAA", timeout)
        return r[0], r[1]

    def ping(self, timeout: float = 0.5) -> bool:
        """Whether a device answers on this slot right now.

        An empty slot, or a device that is off or asleep, gets a HID++ 1.0
        error back from the receiver, so this is quick either way.
        """
        try:
            self.protocol_version(timeout)
        except HidppError:
            return False
        return True

    def list_features(self) -> list[tuple[int, int, int]]:
        """Return [(index, feature_id, flags)] for every feature the device exposes."""
        fs = self.feature_index(0x0001)
        count = self.request(fs, 0)[0]
        out = []
        for i in range(count + 1):
            r = self.request(fs, 1, bytes([i]))
            out.append((i, int.from_bytes(r[0:2], "big"), r[2]))
        return out

    def name(self) -> str:
        idx = self.feature_index(0x0005)
        if idx is None:
            return "?"
        length = self.request(idx, 0)[0]
        name = b""
        while len(name) < length:
            name += self.request(idx, 1, bytes([len(name)]))
        return name[:length].decode(errors="replace")
