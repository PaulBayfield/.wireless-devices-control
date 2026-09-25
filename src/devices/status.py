"""The status screen, one row at a time.

Two models printed almost the same status screen in almost the same order,
so the rows live here as named renderers and a model declares which of them
it wants, in which order, as
:attr:`~src.devices.base.Device.STATUS_ROWS`.

A renderer takes the device and returns a ``(label, value)`` pair, or
``None`` to be left out -- which is what happens when the device has no such
feature or declined to answer, since each one reads through
:meth:`~src.devices.base.Device.safe`. That is why a row can be
listed by a model whose firmware sometimes withholds it without the whole
screen failing.

A model with a row of its own registers it in its own
:attr:`~src.devices.base.Device.ROWS`; see
:mod:`src.devices.qc45`.
"""

from ..output import bar, on_off

#: Row name to renderer. Extended per model, never mutated by one.
ROWS = {}


def renders(name):
    """Register a renderer under *name* in :data:`ROWS`."""
    def register(function):
        ROWS[name] = function
        return function
    return register


@renders("model")
def model(dev):
    """The factory model string if the device has one, else the model name."""
    reported = dev.safe(dev.model)
    if reported and dev.CODENAME:
        return ("Model", "%s (%s)" % (reported, dev.CODENAME))
    return ("Model", reported or dev.NAME)


@renders("name")
def name(dev):
    """The Bluetooth name the device answers to."""
    value = dev.safe(dev.name)
    return ("Name", value) if value else None


@renders("battery")
def battery(dev):
    """Charge percentage."""
    percent = dev.safe(dev.battery)
    return ("Battery", "%d%%" % percent) if percent is not None else None


@renders("volume")
def volume(dev):
    """Volume, as a meter and a fraction of the device's own step count."""
    level, steps = dev.safe(dev.volume, (None, None))
    if level is None:
        return None
    return ("Volume", "%s %d/%d" % (bar(level, steps), level, steps))


@renders("source")
def source(dev):
    """The active input, and the address it is playing from."""
    playing = dev.safe(dev.source)
    if playing is None or playing.kind == "none":
        return None
    return ("Source", "%s%s" % (playing.kind,
                                " from %s" % playing.mac if playing.mac else ""))


@renders("eq")
def eq(dev):
    """The three EQ bands as signed offsets."""
    bands = dev.safe(dev.eq, [])
    if not bands:
        return None
    return ("EQ", "%s (bass/mid/treble)"
            % "/".join("%+d" % band.current for band in bands))


@renders("standby")
def standby(dev):
    """The auto-off timer."""
    minutes = dev.safe(dev.standby_minutes)
    return ("Auto-off", "%d min" % minutes) if minutes is not None else None


@renders("multipoint")
def multipoint(dev):
    """Whether two-device multipoint is on."""
    return ("Multipoint", on_off(dev.safe(dev.multipoint, False)))


@renders("prompts")
def prompts(dev):
    """Voice prompts, and the language they speak."""
    enabled, language = dev.safe(dev.prompts, (False, ""))
    return ("Prompts", "%s (%s)" % (on_off(enabled), language))


@renders("power")
def power(dev):
    """Power state, on a model that reports one."""
    return ("Power", on_off(dev.safe(dev.powered_on)))


@renders("sidetone")
def sidetone(dev):
    """Sidetone level, on a model with a microphone."""
    level = dev.safe(dev.sidetone)
    return ("Sidetone", level) if level else None


@renders("firmware")
def firmware(dev):
    """Firmware version."""
    value = dev.safe(dev.firmware)
    return ("Firmware", value) if value else None


@renders("serial")
def serial(dev):
    """Serial number."""
    value = dev.safe(dev.serial)
    return ("Serial", value) if value else None


@renders("mac")
def mac(dev):
    """The device's own Bluetooth address."""
    value = dev.safe(dev.mac)
    return ("MAC", value) if value else None
