"""High-level control of a Logitech G502 LIGHTSPEED over HID++ 2.0."""

import bisect

from src.core import device as core
from src.core.battery import Battery, ChargeState

from .hidpp import HidppDevice, HidppError

# Voltage (mV) -> % discharge curve for Logitech's Li-ion gaming mice
# (same table G HUB / Solaar use for 0x1001 BATTERY_VOLTAGE devices).
VOLTAGE_CURVE = [
    (3500, 0), (3579, 2), (3646, 5), (3671, 10), (3717, 20), (3751, 30), (3778, 40),
    (3811, 50), (3859, 60), (3922, 70), (3989, 80), (4067, 90), (4186, 100),
]
#: Low bits of the 0x1001 flags byte, meaningful when bit 7 (external power) is set.
CHARGE_STATES = {0: ChargeState.CHARGING, 1: ChargeState.FULL,
                 2: ChargeState.NOT_CHARGING, 3: ChargeState.ERROR}

LED_ZONES = {"primary": 0, "logo": 1}
LED_EFFECT_INDEX = {"off": 0, "static": 1, "breathe": 2, "cycle": 3}

# Onboard profile layout (0x8100 memory), as Solaar documents it and as read
# back from this mouse: byte 0 is the report rate, then the DPI list, and at
# 0xD0 one 11-byte lighting entry per zone, in zone order.
PROFILE_LED_OFFSET = 0xD0
PROFILE_LED_SIZE = 11
#: Profile lighting effect id -> name. Colour, where there is one, is bytes 1-3.
PROFILE_LED_EFFECTS = {0x00: "off", 0x01: "static", 0x02: "breathe", 0x03: "cycle",
                       0x0A: "breathe", 0x0B: "ripple"}
_COLOURED = ("static", "breathe", "ripple")


def voltage_to_percent(mv: int) -> int:
    volts = [v for v, _ in VOLTAGE_CURVE]
    if mv <= volts[0]:
        return 0
    if mv >= volts[-1]:
        return 100
    i = bisect.bisect_right(volts, mv)
    (v0, p0), (v1, p1) = VOLTAGE_CURVE[i - 1], VOLTAGE_CURVE[i]
    return round(p0 + (p1 - p0) * (mv - v0) / (v1 - v0))


def parse_battery(payload: bytes) -> Battery:
    """A 0x1001 BATTERY_VOLTAGE reply (or event): millivolts, then a flags byte."""
    mv = int.from_bytes(payload[0:2], "big")
    flags = payload[2]
    if flags & 0x80:
        state = CHARGE_STATES.get(flags & 0x07, ChargeState.ERROR)
    else:
        state = ChargeState.DISCHARGING
    pct = 100 if state is ChargeState.FULL else voltage_to_percent(mv)
    return Battery(pct, state, mv)


class G502(HidppDevice, core.Device):
    VENDOR = "logitech"
    KIND = "mouse"
    KEY = "g502"
    NAME = "Logitech G502 LIGHTSPEED"
    #: Discovery matches a device to this class when its reported name contains this.
    MATCH = "G502"

    # --- battery (0x1001) ------------------------------------------------
    def battery(self) -> Battery:
        return parse_battery(self.request(self.feature_index(0x1001), 0))

    # --- DPI (0x2201) ----------------------------------------------------
    def dpi_range(self) -> tuple[int, int, int]:
        """(min, max, step) — G502 reports a single range entry: lo, 0xE0|step, hi."""
        r = self.request(self.feature_index(0x2201), 1, b"\x00")[1:]
        words = [int.from_bytes(r[i:i + 2], "big") for i in range(0, len(r) - 1, 2)]
        lo, step, hi = words[0], words[1] & 0x1FFF, words[2]
        return lo, hi, step

    def get_dpi(self) -> tuple[int, int]:
        """(current, default)"""
        r = self.request(self.feature_index(0x2201), 2, b"\x00")
        return int.from_bytes(r[1:3], "big"), int.from_bytes(r[3:5], "big")

    def set_dpi(self, dpi: int) -> int:
        lo, hi, step = self.dpi_range()
        dpi = max(lo, min(hi, round(dpi / step) * step))
        self.request(self.feature_index(0x2201), 3, b"\x00" + dpi.to_bytes(2, "big"))
        return dpi

    # --- report rate (0x8060) --------------------------------------------
    def report_rates(self) -> list[int]:
        """Supported polling rates in Hz."""
        mask = self.request(self.feature_index(0x8060), 0)[0]
        return [1000 // (b + 1) for b in range(8) if mask & (1 << b)]

    def get_report_rate(self) -> int:
        return 1000 // self.request(self.feature_index(0x8060), 1)[0]

    def set_report_rate(self, hz: int) -> int:
        ms = max(1, round(1000 / hz))
        self.request(self.feature_index(0x8060), 2, bytes([ms]))
        return 1000 // ms

    # --- onboard profiles (0x8100) ---------------------------------------
    def get_onboard_mode(self) -> str:
        m = self.request(self.feature_index(0x8100), 2)[0]
        return {1: "onboard", 2: "host"}.get(m, f"unknown({m})")

    def get_profile_leds(self) -> dict[str, dict]:
        """Lighting stored in the active onboard profile, per zone.

        What the LEDs show in onboard mode: ``{zone: {"effect", "color"}}``,
        the colour as ``"rrggbb"`` or ``None`` for effects without one. Read
        from profile memory (0x8100 fn 5, 16 bytes at a time).
        """
        idx = self.feature_index(0x8100)
        sector = self.request(idx, 4)[0:2]
        raw = b""
        for offset in (PROFILE_LED_OFFSET, PROFILE_LED_OFFSET + 16):
            raw += self.request(idx, 5, sector + offset.to_bytes(2, "big"))
        leds = {}
        for zone, index in LED_ZONES.items():
            entry = raw[index * PROFILE_LED_SIZE:(index + 1) * PROFILE_LED_SIZE]
            effect = PROFILE_LED_EFFECTS.get(entry[0], "unknown")
            leds[zone] = {"effect": effect,
                          "color": entry[1:4].hex() if effect in _COLOURED else None}
        return leds

    def set_onboard_mode(self, mode: str):
        self.request(self.feature_index(0x8100), 1, bytes([{"onboard": 1, "host": 2}[mode]]))

    # --- LEDs (0x8070) ---------------------------------------------------
    def set_led(self, zone: str, effect: str, rgb: tuple[int, int, int] = (255, 255, 255),
                period_ms: int = 3000, brightness: int = 100):
        params = bytearray(10)
        if effect == "static":
            params[0:3] = bytes(rgb)
        elif effect == "breathe":
            params[0:3] = bytes(rgb)
            params[3:5] = period_ms.to_bytes(2, "big")
            params[5] = 0  # waveform: default
            params[6] = brightness
        elif effect == "cycle":
            params[5:7] = period_ms.to_bytes(2, "big")
            params[7] = brightness
        zones = LED_ZONES.values() if zone == "all" else [LED_ZONES[zone]]
        for z in zones:
            self.request(self.feature_index(0x8070), 3,
                         bytes([z, LED_EFFECT_INDEX[effect]]) + bytes(params) + b"\x01")


__all__ = ["G502", "HidppError", "parse_battery", "voltage_to_percent"]
