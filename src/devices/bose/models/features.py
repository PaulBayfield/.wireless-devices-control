"""The feature vocabulary: one method per thing a device can be asked.

Every method here is written against a *feature name*, never an address. It
works on any model whose table declares that name and raises
:class:`~src.devices.bose.protocol.errors.BmapUnsupported` on one that does not,
so a model gets ``battery()`` by writing ``"battery"`` in its table and
nothing else.

That is the whole reason the model modules are short. This mixin is folded
into :class:`~src.devices.bose.models.base.Device`; it is kept apart from the
protocol plumbing there so that the two can be read separately -- plumbing
in one file, the vocabulary it serves in this one.
"""

from src.core.battery import Battery

from ..protocol import OP_PROCESSING, OP_RESULT, OP_STATUS, parsers
from ..protocol.errors import BmapConnectionError, BmapError, BmapTimeoutError


class FeatureMethods:
    """Everything a device can be asked, on top of the four raw operations.

    Mixed into :class:`~src.devices.bose.models.base.Device`, which supplies
    :meth:`~src.devices.bose.models.base.Device.get`,
    :meth:`~src.devices.bose.models.base.Device.get_raw`,
    :meth:`~src.devices.bose.models.base.Device.set` and
    :meth:`~src.devices.bose.models.base.Device.start`.
    """

    #: No volume write goes above this without being asked for in so many
    #: words. A model with a different range can raise or lower it.
    SAFE_MAX_VOLUME = 15

    # -- identity ------------------------------------------------------------

    def firmware(self):
        """Firmware version string."""
        return self.get("firmware")

    def model(self):
        """The factory model string, where the device carries one."""
        return self.get("model")

    def serial(self):
        """Serial number."""
        return self.get("serial")

    def mac(self):
        """This device's own Bluetooth address."""
        return self.get("bt_mac")

    def product_id(self):
        """``(product id, variant)`` as the device reports it at ``[0.3]``."""
        return self.get("product_id")

    def name(self):
        """The Bluetooth name."""
        return self.get("product_name")

    def set_name(self, new_name):
        """Rename the device over Bluetooth."""
        self.set("product_name", new_name)

    # -- state ---------------------------------------------------------------

    def battery(self):
        """Charge percentage, as a :class:`~src.core.battery.Battery`.

        BMAP ``[2.2]`` carries the level only, so the charging state is
        left unknown.
        """
        return Battery(self.get("battery"))

    def powered_on(self):
        """Power state, where the model reports one."""
        payload = self.get_raw("power")
        return bool(payload[0]) if payload else None

    def power_off(self):
        """Power the device off: START on the Control block with a zero byte.

        The link dies with the device, so a dropped socket here is the
        success case. Only an ERROR reply means it refused.

        :returns: ``True`` when the device acknowledged or went away.
        """
        try:
            responses = self.start("power", bytes([0x00]))
        except (BmapTimeoutError, BmapConnectionError):
            return True  # the socket died along with the device
        return any(r.op in (OP_RESULT, OP_PROCESSING, OP_STATUS)
                   for r in responses)

    def standby_minutes(self):
        """Auto-off timer, in minutes."""
        return self.get("standby")

    def set_standby_minutes(self, minutes):
        """Set the auto-off timer. Untested on hardware on either model."""
        self.set("standby", minutes)

    # -- sound ---------------------------------------------------------------

    def eq(self):
        """The EQ bands, bass first."""
        return self.get("eq")

    def set_eq(self, bass, mid, treble):
        """Set the three EQ bands, each -10 to +10. One packet per band."""
        for band_id, value in enumerate((bass, mid, treble)):
            self.set("eq", value, band_id)

    def volume(self):
        """Volume as ``(level, steps)``. The step count differs per model."""
        return self.get("volume")

    def set_volume(self, level, force=False):
        """Set the volume, 0 to the step count the device reports.

        Anything above :attr:`SAFE_MAX_VOLUME` needs *force*. A write lands
        instantly and these devices go loud enough to hurt, so a mistyped
        number should be harmless rather than painful.

        :raises ValueError: when the level is out of range, or above the
            ceiling without *force*.
        """
        _current, steps = self.volume()
        if steps is None:
            raise BmapError("%s did not report a volume range" % self.NAME)
        if not 0 <= level <= steps:
            raise ValueError("Volume must be 0-%d, got %s" % (steps, level))
        if level > self.SAFE_MAX_VOLUME and not force:
            raise ValueError(
                "Volume %d is above the safe ceiling of %d. Pass force=True "
                "(or --loud on the command line) if you really mean it."
                % (level, self.SAFE_MAX_VOLUME))
        self.set("volume", level)
        return level

    def nudge_volume(self, delta, force=False):
        """Move the volume by *delta* steps, clamped to the safe range."""
        current, steps = self.volume()
        if current is None:
            raise BmapError("%s did not report its volume" % self.NAME)
        ceiling = steps if force else min(steps, self.SAFE_MAX_VOLUME)
        return self.set_volume(max(0, min(ceiling, current + delta)), force=force)

    def source(self):
        """The active input, and what it is playing from over Bluetooth."""
        return self.get("source")

    def control(self, action):
        """Transport control: play, pause, stop, next, prev and friends.

        A device advertises which of them it takes as a bitmap in GET
        ``[5.3]``; :meth:`transport_controls` decodes it.
        """
        self.start("transport_control", action)

    def transport_controls(self):
        """The control names this device says it accepts."""
        return parsers.transport_controls(self.get_raw("transport_control"))

    def sidetone(self):
        """Sidetone level name: off, low, medium or high."""
        return self.get("sidetone")

    def set_sidetone(self, level):
        """Set sidetone: off, low, medium or high."""
        self.set("sidetone", level)

    # -- behaviour -----------------------------------------------------------

    def prompts(self):
        """Voice prompts as ``(enabled, language name)``."""
        return self.get("voice_prompts")

    def set_prompts(self, enabled):
        """Turn voice prompts on or off, keeping the current language."""
        payload = self.get_raw("voice_prompts")
        language = payload[0] & 0x1F if payload else 0
        self.set("voice_prompts", enabled, language)

    def multipoint(self):
        """Whether two-device multipoint is on."""
        return self.get("multipoint")

    def set_multipoint(self, enabled):
        """Turn multipoint on or off."""
        self.set("multipoint", enabled)

    def buttons(self):
        """The current button mapping."""
        return self.get("buttons")

    def set_buttons(self, button, event, action):
        """Remap a button. Each argument takes a name or a numeric id.

        :returns: the mapping the device echoed back, or ``None`` if it
            acknowledged without one.
        """
        responses = self.set("buttons", button, event, action)
        if responses and responses[0].payload:
            return parsers.buttons(responses[0].payload)
        return None

    # -- pairing -------------------------------------------------------------

    def active_device(self):
        """The address of the device currently connected to this one."""
        return self.get("active_device")

    def device_list(self):
        """The addresses this device remembers, as a ``DeviceList``."""
        return self.get("device_list")

    def pairing(self):
        """Whether the device is in pairing mode right now."""
        payload = self.get_raw("pairing")
        return bool(payload[0]) if payload else False

    def set_pairing(self, enabled=True):
        """Enter or leave Bluetooth pairing mode."""
        self.start("pairing", bytes([1 if enabled else 0]))
