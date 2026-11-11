"""Bose settings and actions, for the API.

Built on the feature table each model declares: a setting appears here only
when the model has the feature behind it (``dev.has(...)``), and the QC45's
mode slots only on a model with mode methods.
"""

from src.devices.bose.protocol.vocabulary import TRANSPORT_CONTROLS

from . import validate

EQ_BANDS = ("bass", "mid", "treble")


def _has_modes(dev) -> bool:
    return hasattr(dev, "set_mode") and dev.has("current_mode")


def read(dev) -> dict:
    """Every setting this model has, with the ranges to draw it."""
    settings: dict = {"name": dev.safe(dev.name)}

    if dev.has("volume"):
        level, steps = dev.safe(dev.volume, (None, None))
        if level is not None:
            settings["volume"] = {"level": level, "max": steps,
                                  "safe_max": dev.SAFE_MAX_VOLUME}
    if dev.has("eq"):
        bands = dev.safe(dev.eq, [])
        if bands:
            settings["eq"] = [{"band": band.name.lower(), "value": band.current,
                               "min": band.min_val, "max": band.max_val}
                              for band in bands]
    if dev.has("source"):
        playing = dev.safe(dev.source)
        if playing is not None:
            settings["source"] = {"kind": playing.kind, "address": playing.mac}
    if dev.has("standby"):
        settings["standby_minutes"] = dev.safe(dev.standby_minutes)
    if dev.has("multipoint"):
        settings["multipoint"] = dev.safe(dev.multipoint)
    if dev.has("voice_prompts"):
        enabled, language = dev.safe(dev.prompts, (None, None))
        settings["prompts"] = {"enabled": enabled, "language": language}
    if dev.has("sidetone"):
        settings["sidetone"] = {"level": dev.safe(dev.sidetone),
                                "levels": ["off", "low", "medium", "high"]}

    if _has_modes(dev):
        level, maximum = dev.safe(dev.cnc, (None, 10))
        settings["cnc"] = {"level": level, "max": maximum}
        slots = dev.safe(dev.modes, {})
        current = dev.safe(dev.mode_idx)
        settings["mode"] = {
            "current": current,
            "modes": [{"slot": idx, "name": config.name, "editable": config.editable,
                       "configured": config.configured, "cnc": config.cnc_level,
                       "wind_block": config.wind_block}
                      for idx, config in sorted(slots.items())],
        }

    settings["info"] = {"firmware": dev.safe(dev.firmware),
                        "serial": dev.safe(dev.serial),
                        "mac": dev.safe(dev.mac)}
    settings["actions"] = actions(dev)
    return settings


def actions(dev) -> list[str]:
    """What :func:`act` accepts on this device."""
    available = []
    if dev.has("transport_control"):
        available += dev.safe(dev.transport_controls, [])
    if dev.has("power"):
        available.append("power_off")
    if dev.has("pairing"):
        available.append("pairing")
    return available


def _accepted(dev) -> set[str]:
    accepted = {"name"} if dev.has("product_name") else set()
    for field, feature in (("volume", "volume"), ("loud", "volume"), ("eq", "eq"),
                           ("standby_minutes", "standby"), ("multipoint", "multipoint"),
                           ("prompts", "voice_prompts"), ("sidetone", "sidetone")):
        if dev.has(feature):
            accepted.add(field)
    if _has_modes(dev):
        accepted |= {"mode", "cnc", "wind_block"}
    return accepted


def apply(dev, changes: dict) -> None:
    """Change some settings. Checked in full before anything is written.

    ``volume`` stops at the device's safe ceiling unless ``loud`` is true, as
    on the command line. ``mode`` is applied before ``cnc`` and
    ``wind_block``, which are stored in the current mode slot.
    """
    validate.no_unknown(changes, _accepted(dev))

    writes = []
    if "name" in changes:
        name = validate.text(changes["name"], "name", 30)
        writes.append(lambda: dev.set_name(name))
    if "volume" in changes:
        level = validate.integer(changes["volume"], "volume", 0)
        loud = validate.boolean(changes.get("loud", False), "loud")
        if level > dev.SAFE_MAX_VOLUME and not loud:
            raise ValueError(
                f"Volume {level} is above the safe ceiling of {dev.SAFE_MAX_VOLUME}. "
                "Send \"loud\": true as well if you really mean it."
            )
        writes.append(lambda: dev.set_volume(level, force=loud))
    if "eq" in changes:
        bands = validate.mapping(changes["eq"], "eq")
        validate.no_unknown(bands, EQ_BANDS)
        values = {band: validate.integer(value, f"eq.{band}", -10, 10)
                  for band, value in bands.items()}

        def write_eq():
            current = {band.name.lower(): band.current for band in dev.eq()}
            merged = [values.get(band, current.get(band, 0)) for band in EQ_BANDS]
            dev.set_eq(*merged)
        writes.append(write_eq)
    if "standby_minutes" in changes:
        minutes = validate.integer(changes["standby_minutes"], "standby_minutes", 0, 65535)
        writes.append(lambda: dev.set_standby_minutes(minutes))
    if "multipoint" in changes:
        enabled = validate.boolean(changes["multipoint"], "multipoint")
        writes.append(lambda: dev.set_multipoint(enabled))
    if "prompts" in changes:
        enabled = validate.boolean(changes["prompts"], "prompts")
        writes.append(lambda: dev.set_prompts(enabled))
    if "sidetone" in changes:
        level = validate.choice(changes["sidetone"], "sidetone", ("off", "low", "medium", "high"))
        writes.append(lambda: dev.set_sidetone(level))
    if "mode" in changes:
        mode = changes["mode"]
        if isinstance(mode, bool) or not isinstance(mode, int | str):
            raise ValueError("'mode' must be a slot number or a mode name.")
        writes.append(lambda: dev.set_mode(mode))
    if "cnc" in changes:
        level = validate.integer(changes["cnc"], "cnc", 0, 10)
        writes.append(lambda: dev.set_cnc(level))
    if "wind_block" in changes:
        enabled = validate.boolean(changes["wind_block"], "wind_block")
        writes.append(lambda: dev.set_wind(enabled))

    for write in writes:
        write()


def act(dev, action: str, params: dict) -> None:
    """Run one action: a transport control, ``power_off``, or ``pairing``."""
    if action in TRANSPORT_CONTROLS:
        if not dev.has("transport_control") or action not in dev.transport_controls():
            raise ValueError(f"This device does not accept '{action}'.")
        dev.control(action)
    elif action == "power_off" and dev.has("power"):
        dev.power_off()
    elif action == "pairing" and dev.has("pairing"):
        dev.set_pairing(validate.boolean(params.get("enabled", True), "enabled"))
    else:
        raise ValueError(f"Unknown action '{action}'. Available: {', '.join(actions(dev))}.")
