"""Logitech settings, for the API. The G502 has no one-shot actions."""

from src.devices.logitech.g502 import LED_EFFECT_INDEX, LED_ZONES

from . import validate

ONBOARD_MODES = ("host", "onboard")


def read(dev) -> dict:
    """DPI, report rate and profile mode, with their ranges; LED choices.

    LEDs are write-only over HID++ here, so only what can be set is listed.
    """
    current, default = dev.get_dpi()
    lo, hi, step = dev.dpi_range()
    return {
        "name": dev.name(),
        "dpi": {"value": current, "default": default, "min": lo, "max": hi, "step": step},
        "report_rate": {"value": dev.get_report_rate(), "supported": dev.report_rates()},
        "onboard_mode": {"value": dev.get_onboard_mode(), "modes": list(ONBOARD_MODES)},
        "led": {"zones": [*LED_ZONES, "all"], "effects": list(LED_EFFECT_INDEX)},
        "actions": [],
    }


def apply(dev, changes: dict) -> None:
    """Change some settings. Checked in full before anything is written.

    ``led`` takes ``{"zone", "effect", "color": "RRGGBB", "period", "brightness"}``.
    In host mode G HUB may overwrite DPI and LED changes; ``onboard_mode``
    ``"onboard"`` keeps them.
    """
    validate.no_unknown(changes, ("dpi", "report_rate", "onboard_mode", "led"))

    writes = []
    # First, so a report rate sent alongside "host" lands in host mode.
    if "onboard_mode" in changes:
        mode = validate.choice(changes["onboard_mode"], "onboard_mode", ONBOARD_MODES)
        writes.append(lambda: dev.set_onboard_mode(mode))
    if "dpi" in changes:
        lo, hi, _step = dev.dpi_range()
        dpi = validate.integer(changes["dpi"], "dpi", lo, hi)
        writes.append(lambda: dev.set_dpi(dpi))
    if "report_rate" in changes:
        hz = validate.integer(changes["report_rate"], "report_rate")
        validate.choice(hz, "report_rate", dev.report_rates())
        # The onboard profile owns the rate: the mouse refuses it outside host mode.
        if changes.get("onboard_mode", dev.get_onboard_mode()) != "host":
            raise ValueError(
                "The report rate can only be changed in host mode: send \"onboard_mode\": \"host\" with it."
            )
        writes.append(lambda: dev.set_report_rate(hz))
    if "led" in changes:
        led = validate.mapping(changes["led"], "led")
        validate.no_unknown(led, ("zone", "effect", "color", "period", "brightness"))
        zone = validate.choice(led.get("zone"), "led.zone", [*LED_ZONES, "all"])
        effect = validate.choice(led.get("effect"), "led.effect", list(LED_EFFECT_INDEX))
        color = led.get("color", "ffffff")
        try:
            rgb = tuple(bytes.fromhex(color))
        except (TypeError, ValueError):
            rgb = ()
        if len(rgb) != 3:
            raise ValueError("'led.color' must be a hex colour like 'ff0000'.")
        period = validate.integer(led.get("period", 3000), "led.period", 100, 60000)
        brightness = validate.integer(led.get("brightness", 100), "led.brightness", 0, 100)
        writes.append(lambda: dev.set_led(zone, effect, rgb, period, brightness))

    for write in writes:
        write()


def act(dev, action: str, params: dict) -> None:
    raise ValueError(f"Unknown action '{action}'. This device has none.")
