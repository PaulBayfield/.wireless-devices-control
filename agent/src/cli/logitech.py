"""logitech -- G502 LIGHTSPEED control over HID++, through its receiver.

    uv run __main__.py logitech info
    uv run __main__.py logitech battery [--watch] [--interval 30]
    uv run __main__.py logitech dpi [VALUE]
    uv run __main__.py logitech rate [HZ]
    uv run __main__.py logitech led {primary,logo,all} {off,static,breathe,cycle} [--color RRGGBB]
    uv run __main__.py logitech mode [host|onboard]
    uv run __main__.py logitech features
"""

import argparse
import sys
import time
from datetime import datetime

from src.core.battery import Battery
from src.core.output import RED, RESET
from src.devices.logitech.g502 import G502, HidppError, parse_battery
from src.devices.logitech.hidpp import FEATURES, LONG_LEN


def cmd_info(m: G502, a):
    print(f"Device:      {m.name()}")
    print(f"Battery:     {m.battery()}")
    cur, default = m.get_dpi()
    lo, hi, step = m.dpi_range()
    print(f"DPI:         {cur} (default {default}, range {lo}-{hi} step {step})")
    print(f"Report rate: {m.get_report_rate()} Hz (supported {m.report_rates()})")
    print(f"Profiles:    {m.get_onboard_mode()} mode")


def cmd_features(m: G502, a):
    for i, f, fl in m.list_features():
        print(f"[{i:2}] 0x{f:04x} {FEATURES.get(f, ''):26} flags=0x{fl:02x}")


def cmd_battery(m: G502, a):
    if not a.watch:
        print(m.battery())
        return
    # Live mode: the mouse broadcasts a 0x1001 event (sw_id 0) whenever the
    # voltage/charging state changes; we also poll as a fallback.
    batt_idx = m.feature_index(0x1001)
    last = None
    next_poll = 0.0

    def show(b: Battery, src: str):
        nonlocal last
        if a.all or str(b) != last:
            print(f"{datetime.now():%H:%M:%S}  {b}  [{src}]", flush=True)
            last = str(b)

    while True:
        now = time.monotonic()
        if now >= next_poll:
            try:
                show(m.battery(), "poll")
            except HidppError as e:
                print(f"{datetime.now():%H:%M:%S}  {e}", flush=True)
            next_poll = now + a.interval
        r = m.long.read(LONG_LEN, 500)
        if r and r[1] == m.index and r[2] == batt_idx and r[3] & 0x0F == 0:
            show(parse_battery(bytes(r[4:])), "event")


def cmd_dpi(m: G502, a):
    if a.value:
        print(f"DPI set to {m.set_dpi(a.value)}")
    else:
        print(m.get_dpi()[0])


def cmd_rate(m: G502, a):
    if a.hz:
        print(f"Report rate set to {m.set_report_rate(a.hz)} Hz")
    else:
        print(f"{m.get_report_rate()} Hz")


def cmd_led(m: G502, a):
    rgb = tuple(bytes.fromhex(a.color))
    m.set_led(a.zone, a.effect, rgb, a.period, a.brightness)
    print(f"LED {a.zone} -> {a.effect}")


def cmd_mode(m: G502, a):
    if a.mode:
        m.set_onboard_mode(a.mode)
    print(f"{m.get_onboard_mode()} mode")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="__main__.py logitech",
        description="Control a Logitech G502 LIGHTSPEED via HID++")
    p.add_argument("--slot", type=int, default=1, help="receiver slot (default 1)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("info", help="name, battery, DPI, rate, profile mode").set_defaults(fn=cmd_info)
    sub.add_parser("features", help="dump the HID++ feature table").set_defaults(fn=cmd_features)

    s = sub.add_parser("battery", help="battery level, or live updates with --watch")
    s.add_argument("-w", "--watch", action="store_true", help="live updates")
    s.add_argument("-i", "--interval", type=float, default=30, help="poll seconds in watch mode")
    s.add_argument("--all", action="store_true", help="print every reading, not only changes")
    s.set_defaults(fn=cmd_battery)

    s = sub.add_parser("dpi", help="show or set the DPI")
    s.add_argument("value", type=int, nargs="?")
    s.set_defaults(fn=cmd_dpi)

    s = sub.add_parser("rate", help="show or set the report rate")
    s.add_argument("hz", type=int, nargs="?", choices=[125, 250, 500, 1000])
    s.set_defaults(fn=cmd_rate)

    s = sub.add_parser("led", help="set an LED effect")
    s.add_argument("zone", choices=["primary", "logo", "all"])
    s.add_argument("effect", choices=["off", "static", "breathe", "cycle"])
    s.add_argument("--color", default="ffffff", help="RRGGBB")
    s.add_argument("--period", type=int, default=3000, help="ms, breathe/cycle")
    s.add_argument("--brightness", type=int, default=100)
    s.set_defaults(fn=cmd_led)

    s = sub.add_parser("mode", help="onboard profile mode")
    s.add_argument("mode", nargs="?", choices=["host", "onboard"])
    s.set_defaults(fn=cmd_mode)
    return p


def main(argv=None) -> int:
    """Parse, open the mouse, dispatch. Returns 0, or 1 on a HID++ failure."""
    a = build_parser().parse_args(sys.argv[1:] if argv is None else argv)
    try:
        with G502(a.slot) as m:
            a.fn(m, a)
    except HidppError as e:
        print(f"{RED}Error:{RESET} {e}", file=sys.stderr)
        return 1
    return 0
