"""Logitech settings, for the API. The G502 has no one-shot actions."""

from src.devices.logitech.g502 import LED_EFFECT_INDEX, LED_ZONES
from src.devices.logitech.hidpp import HidppError

from . import validate

ONBOARD_MODES = ("host", "onboard")

#: What the dashboard last set on each receiver slot: ``{slot: {zone:
#: {"effect", "color"}}}``. The mouse cannot report its lighting, and an
#: effect set in onboard mode shows on the LEDs without being written to the
#: profile, so this takes priority over the profile for the zones it covers.
#: In memory: it starts empty with the API, and a mode change -- which makes
#: the mouse reload its profile's lighting -- clears it.
_set_leds: dict[int, dict[str, dict]] = {}


def _current_leds(dev, mode: str) -> tuple[dict | None, str | None]:
    """The lighting now, per zone, and where that knowledge comes from.

    Each zone carries its own ``source``: ``"profile"`` or ``"last set"``.
    The overall source is one of those, ``"mixed"``, or None when unknown.
    """
    leds: dict[str, dict] = {}
    if mode == "onboard":
        try:
            leds = {zone: {**light, "source": "profile"}
                    for zone, light in dev.get_profile_leds().items()}
        except HidppError:
            pass
    for zone, light in _set_leds.get(dev.index, {}).items():
        leds[zone] = {**light, "source": "last set"}
    if not leds:
        return None, None
    sources = {light["source"] for light in leds.values()}
    return leds, sources.pop() if len(sources) == 1 else "mixed"


def read(dev) -> dict:
    """DPI, report rate and profile mode, with their ranges; the lighting.

    ``led.current`` is what each zone shows: what was last set here, else in
    onboard mode what the active profile holds; ``None`` when unknown (host
    mode, nothing set yet). ``led.source`` says which, per zone and overall.
    """
    current, default = dev.get_dpi()
    lo, hi, step = dev.dpi_range()
    mode = dev.get_onboard_mode()
    leds, source = _current_leds(dev, mode)
    return {
        "name": dev.name(),
        "dpi": {"value": current, "default": default, "min": lo, "max": hi, "step": step},
        "report_rate": {"value": dev.get_report_rate(), "supported": dev.report_rates()},
        "onboard_mode": {"value": mode, "modes": list(ONBOARD_MODES)},
        "led": {"zones": [*LED_ZONES, "all"], "effects": list(LED_EFFECT_INDEX),
                "current": leds, "source": source},
        "actions": [],
    }


def _remember_led(dev, zone: str, effect: str, color: str) -> None:
    zones = LED_ZONES if zone == "all" else [zone]
    remembered = _set_leds.setdefault(dev.index, {})
    for name in zones:
        remembered[name] = {"effect": effect,
                            "color": color if effect in ("static", "breathe") else None}


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

        def write_mode():
            dev.set_onboard_mode(mode)
            _set_leds.pop(dev.index, None)  # the mouse reloads the profile's lighting
        writes.append(write_mode)
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

        def write_led():
            dev.set_led(zone, effect, rgb, period, brightness)
            _remember_led(dev, zone, effect, color.lower())
        writes.append(write_led)

    for write in writes:
        write()


def act(dev, action: str, params: dict) -> None:
    raise ValueError(f"Unknown action '{action}'. This device has none.")
