"""Bose QuietComfort 45 headphones -- codename "duran", product id 0x4039.

BMAP on RFCOMM channel 8, and the firmware wants a GET ``[0.5]`` before it
will answer anything else. Verified on hardware: every read below, plus a
ModeConfig write.

The model's one real quirk is noise cancellation. A direct write to CNC
``[1.5]`` is refused as authentication-gated, so the level lives in the
current mode slot instead -- which means it can only be changed while the
headphones are in one of the two editable slots. Slots 0 and 1 are the
factory Quiet and Aware presets.

That quirk is the whole reason this module is longer than
:mod:`src.devices.micro2`: the addresses are shared, the *sequence*
of exchanges is not.
"""

from ..output import CYAN, bar, on_off, row
from ..protocol import OP_PROCESSING, OP_RESULT, OP_STATUS, codec, modes
from ..protocol.errors import BmapDeviceError, BmapError
from . import catalog
from .base import Device

#: Preset name to slot index. These two are factory slots and read-only.
PRESET_MODES = {"quiet": 0, "aware": 1}
#: The reverse, for naming the slot the headphones are in.
MODE_BY_IDX = {0: "quiet", 1: "aware"}
#: The slots that accept a ModeConfig write.
EDITABLE_SLOTS = (2, 3)


class QuietComfort45(Device):
    """The QC45's mode slots, and the noise cancellation stored inside them."""

    KEY = "qc45"
    NAME = "Bose QuietComfort 45"
    CODENAME = "duran"
    PRODUCT_ID = 0x4039
    # The unit itself answers "Duran" at [18.12] and "RIO" at [18.13], where
    # the upstream config had guessed CSR8670 from the app's tables.
    PLATFORM = "RIO"
    CHANNEL = 8
    INIT_ADDR = (0, 5)
    #: Channels BMAP has been seen on elsewhere, tried if 8 goes quiet.
    FALLBACK_CHANNELS = (2, 9)

    FEATURES = catalog.features(
        # One byte here, where the speaker uses two. 0xb4 is 180 minutes.
        standby=catalog.STANDBY_8,
        cnc=catalog.CNC,
        sidetone=catalog.SIDETONE,
        # AudioModes: a 47-byte STATUS, a 39-byte SETGET.
        get_all_modes=catalog.MODES_GET_ALL,
        current_mode=catalog.CURRENT_MODE,
        mode_config=catalog.MODE_CONFIG,
    )

    STATUS_ROWS = ("model", "battery", "mode", "cnc", "volume", "eq",
                   "source", "standby", "name", "sidetone", "multipoint",
                   "prompts", "firmware", "serial", "mac")

    # -- noise cancellation --------------------------------------------------

    def cnc(self):
        """Noise cancellation as ``(level, max)``. Level 0 is maximum ANC."""
        return self.get("cnc")

    def set_cnc(self, level):
        """Set noise cancellation, 0 (maximum ANC) to 10 (most ambient).

        Written through the current mode slot, since ``[1.5]`` itself is
        gated. Every other field of the slot is read first and put back
        unchanged.

        :raises ValueError: when the level is out of range.
        :raises ~src.protocol.errors.BmapError: when the headphones
            are in a factory preset, which stores no adjustable level.
        """
        if not 0 <= level <= 10:
            raise ValueError("CNC level must be 0-10, got %s" % level)
        self._rewrite_current_mode(cnc_level=level)

    def wind(self):
        """Whether wind block is on in the current slot."""
        config = self.modes().get(self.mode_idx())
        return config.wind_block if config else None

    def set_wind(self, enabled):
        """Toggle wind block on the current mode slot."""
        self._rewrite_current_mode(wind_block=bool(enabled))

    # -- mode slots ----------------------------------------------------------

    def mode_idx(self):
        """Index of the mode the headphones are in right now."""
        payload = self.get_raw("current_mode")
        return payload[0] if payload else None

    def modes(self):
        """Every mode slot, as ``{index: ModeConfig}``.

        One START on GetAll ``[31.1]`` makes the device stream a STATUS per
        slot, so this drains the socket rather than reading a single packet.
        """
        wanted = self.FEATURES["mode_config"]["addr"]
        out = {}
        for resp in self.start("get_all_modes", drain=True):
            if (resp.fblock, resp.func) != wanted or resp.op != OP_STATUS:
                continue
            config = modes.parse_config(resp.payload)
            if config is not None:
                out[config.idx] = config
        return out

    def mode(self):
        """Name of the current mode: a preset name, or the slot's own name."""
        idx = self.mode_idx()
        if idx is None:
            return None
        if idx in MODE_BY_IDX:
            return MODE_BY_IDX[idx]
        config = self.safe(self.modes, {}).get(idx)
        return config.name if config else "unknown(%d)" % idx

    def set_mode(self, name, announce=False):
        """Switch modes by preset name, slot name, or slot index.

        :returns: the slot index switched to.
        """
        idx = self._resolve_mode(name)
        responses = self.start("current_mode", bytes([idx, 1 if announce else 0]))
        # This firmware acks with PROCESSING and applies the switch a moment
        # later, so PROCESSING is success rather than a pending failure.
        if responses and responses[0].op not in (OP_RESULT, OP_PROCESSING,
                                                 OP_STATUS):
            raise BmapDeviceError("Mode switch failed: %s"
                                  % codec.fmt(responses[0]))
        return idx

    def write_mode(self, idx, name, cnc_level=0, auto_cnc=False, spatial=0,
                   wind_block=True, prompt_bytes=(0, 0)):
        """Write a whole mode slot. Only :data:`EDITABLE_SLOTS` accept this."""
        responses = self.set("mode_config", idx, name, cnc_level=cnc_level,
                             auto_cnc=auto_cnc, spatial=spatial,
                             wind_block=wind_block, prompt_bytes=prompt_bytes,
                             drain=True)
        if not any(r.op == OP_STATUS for r in responses):
            raise BmapDeviceError("Mode write was not acknowledged")

    def _resolve_mode(self, name):
        """A preset name, a slot name or an index, all to an index."""
        if isinstance(name, int):
            return name
        if name.isdigit():
            return int(name)
        key = name.lower()
        if key in PRESET_MODES:
            return PRESET_MODES[key]
        for idx, config in self.modes().items():
            if config.name.lower() == key:
                return idx
        raise BmapError("Unknown mode: %s" % name)

    def _rewrite_current_mode(self, **changes):
        """Read the current slot, change one field, write it all back."""
        config = self._editable_current_mode()
        fields = {"cnc_level": config.cnc_level, "auto_cnc": config.auto_cnc,
                  "spatial": config.spatial, "wind_block": config.wind_block,
                  "prompt_bytes": config.prompt_bytes}
        fields.update(changes)
        self.write_mode(config.idx, config.name, **fields)

    def _editable_current_mode(self):
        """The current slot, or an explanation of why it cannot change."""
        idx = self.mode_idx()
        config = self.modes().get(idx)
        if config is None:
            raise BmapError("Could not read the current mode's configuration")
        if not config.editable:
            raise BmapError(
                "Mode '%s' (slot %d) is a factory preset and stores no "
                "adjustable level. Switch to an editable slot first -- see "
                "'modes' for slots %s."
                % (config.name, idx, " and ".join(str(s) for s in EDITABLE_SLOTS)))
        return config


# -- Status rows only this model has -----------------------------------------

def _row_mode(dev):
    """Which listening mode the headphones are in, and which slot it is."""
    idx = dev.safe(dev.mode_idx)
    if idx is None:
        return None
    name = MODE_BY_IDX.get(idx)
    if name is None:
        config = dev.safe(dev.modes, {}).get(idx)
        name = config.name if config else "unknown(%d)" % idx
    return ("Mode", "%s (slot %d)" % (name, idx))


def _row_cnc(dev):
    """The cancellation meter.

    The scale is inverted -- 0 is maximum cancellation -- so the bar is drawn
    as "how much cancelling", which is what it sounds like.
    """
    level, maximum = dev.safe(dev.cnc, (0, 10))
    return ("CNC", "%s %d/%d (0 = max ANC)"
            % (bar(maximum - level, maximum), level, maximum))


QuietComfort45.ROWS = {"mode": _row_mode, "cnc": _row_cnc}


# -- Commands only this model has --------------------------------------------

def cmd_cnc(dev, args):
    """Set noise cancellation, 0 (max ANC) to 10 (most ambient)."""
    if not args:
        level, maximum = dev.cnc()
        print("%d/%d" % (level, maximum))
        return
    level = int(args[0])
    dev.set_cnc(level)
    print("CNC %d" % level)


def cmd_wind(dev, args):
    """Show or set wind block on the current mode slot."""
    if not args:
        print(on_off(dev.wind()))
        return
    enabled = args[0].lower() in ("on", "true", "yes", "1")
    dev.set_wind(enabled)
    print("Wind block %s" % on_off(enabled))


def cmd_mode(dev, args):
    """Switch modes by name or slot number. Add 'announce' for the prompt."""
    if not args:
        print(dev.mode())
        return
    announce = len(args) > 1 and args[1].lower() in ("announce", "--announce")
    print("Switched to slot %d" % dev.set_mode(args[0], announce=announce))


def cmd_modes(dev, args):
    """List every mode slot, marking the active one."""
    slots = dev.modes()
    if not slots:
        print("The headphones returned no mode slots.")
        return
    current = dev.mode_idx()
    for idx in sorted(slots):
        config = slots[idx]
        tag = "[preset]" if not config.editable else (
            "" if config.configured else "[empty]")
        detail = "cnc=%d" % config.cnc_level
        if config.wind_block:
            detail += " wind"
        print(" %s %2d  %-16s %-14s %s"
              % ("*" if idx == current else " ", idx,
                 MODE_BY_IDX.get(idx, config.name) or "(unnamed)", detail, tag))


def cmd_quiet(dev, args):
    """Shortcut for the Quiet preset -- full cancellation."""
    dev.set_mode("quiet")
    print("Quiet")


def cmd_aware(dev, args):
    """Shortcut for the Aware preset -- ambient pass-through."""
    dev.set_mode("aware")
    print("Aware")


def cmd_profile(dev, args):
    """Write an editable slot: profile <slot> <name> [cnc-level]."""
    if len(args) < 2:
        raise SystemExit("profile takes a slot and a name, "
                         "e.g. profile 2 Commute 4")
    slot = int(args[0])
    if slot not in EDITABLE_SLOTS:
        raise SystemExit("Only slots %s can be written"
                         % " and ".join(str(s) for s in EDITABLE_SLOTS))
    level = int(args[2]) if len(args) > 2 else 0
    dev.write_mode(slot, args[1], cnc_level=level)
    print("Slot %d is now '%s' at cnc=%d" % (slot, args[1], level))


def cmd_sidetone(dev, args):
    """Show or set sidetone: off, low, medium, high."""
    if not args:
        print(dev.sidetone())
        return
    dev.set_sidetone(args[0])
    row("Sidetone", args[0].lower(), CYAN)


QuietComfort45.COMMANDS = {
    "cnc": cmd_cnc,
    "wind": cmd_wind,
    "mode": cmd_mode,
    "modes": cmd_modes,
    "quiet": cmd_quiet,
    "aware": cmd_aware,
    "profile": cmd_profile,
    "sidetone": cmd_sidetone,
}
