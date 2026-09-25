"""The parent every model inherits from.

A device module in this package is mostly data. It names the addresses its
model uses and points each one at a parser and, where the model accepts
writes, a builder. This class turns that table into methods, so a model that
declares ``battery`` gets :meth:`~.features.FeatureMethods.battery` for free,
and one that does not gets a clear refusal instead of a confusing timeout.

Anything genuinely particular to a model -- the QuietComfort 45 storing its
noise cancellation level inside a mode slot, say -- is a method on that
model's own subclass. The rule of thumb:

    **addresses and payload shapes are data, sequences of exchanges are code.**

What a subclass declares
------------------------

:attr:`Device.KEY`
    short name, for ``--device qc45``
:attr:`Device.NAME`
    what the model is called
:attr:`Device.PRODUCT_ID`
    the id GET ``[0.3]`` reports; the registry key
:attr:`Device.CHANNEL`
    the RFCOMM channel BMAP answers on
:attr:`Device.FEATURES`
    feature name to address, built with
    :func:`~src.devices.catalog.features`
:attr:`Device.STATUS_ROWS`
    which rows ``status`` prints, in order
:attr:`Device.COMMANDS`
    command handlers beyond the shared set
"""

from ..protocol import OP_ERROR, OP_GET, OP_SETGET, OP_START, codec
from ..protocol.errors import BmapDeviceError, BmapError, BmapUnsupported
from . import status
from .features import FeatureMethods


class Device(FeatureMethods):
    """One connected device, driven by its subclass's :attr:`FEATURES` table.

    :param link: an open transport, anything with ``send_recv(data, drain)``
        and ``close()``. In normal use that is
        :class:`~src.transport.rfcomm.RfcommTransport`; in
        :mod:`src.tools.replay` it is a recording.
    """

    # -- identity, filled in by each model -----------------------------------

    #: Short name used for ``--device``.
    KEY = ""
    #: The model's full name, as it appears in output.
    NAME = "Unknown Bose device"
    #: Bose's internal codename, as the device reports it at ``[18.12]``.
    CODENAME = ""
    #: The id GET ``[0.3]`` reports, and the key the registry uses.
    PRODUCT_ID = None
    #: The silicon platform, from ``[18.13]``.
    PLATFORM = ""
    #: The RFCOMM channel BMAP answers on.
    CHANNEL = 8
    #: The GET some firmware wants before it will answer anything else.
    INIT_ADDR = (0, 5)
    #: Channels to try if :attr:`CHANNEL` goes quiet.
    FALLBACK_CHANNELS = ()

    # -- capability ----------------------------------------------------------

    #: ``{feature name: entry}``; see :mod:`src.devices.catalog`.
    FEATURES = {}
    #: Which rows ``status`` prints, in order. Names are looked up in
    #: :data:`src.devices.status.ROWS` and then :attr:`ROWS`.
    STATUS_ROWS = ("model", "name", "battery", "volume", "source", "eq",
                   "standby", "multipoint", "prompts", "power", "firmware",
                   "serial", "mac")
    #: Row renderers this model adds, ``{name: fn(device)}``.
    ROWS = {}
    #: Commands only this model has, ``{name: handler(device, args)}``.
    COMMANDS = {}

    def __init__(self, link):
        self._link = link

    def __repr__(self):
        return "<%s %s>" % (type(self).__name__, self.KEY)

    # -- feature plumbing ----------------------------------------------------

    @classmethod
    def has(cls, feature):
        """Whether this model exposes *feature* at all."""
        return feature in cls.FEATURES

    def _entry(self, feature):
        """The feature's table entry, or a refusal naming the model."""
        entry = self.FEATURES.get(feature)
        if entry is None:
            raise BmapUnsupported("%s has no %r" % (self.NAME, feature))
        return entry

    def _exchange(self, addr, operator, payload=b"", drain=False):
        """Send one packet and return every response, raising on ERROR."""
        responses = codec.parse_all(
            self._link.send_recv(codec.packet(addr, operator, payload),
                                 drain=drain))
        for resp in responses:
            if resp.op == OP_ERROR:
                code = resp.payload[0] if resp.payload else None
                raise BmapDeviceError(
                    "%s: %s" % (codec.ERROR_NAMES.get(code, "error %s" % code),
                                codec.fmt(resp)), error_code=code)
        return responses

    def get(self, feature):
        """GET a feature and run the payload through its parser.

        :returns: whatever the parser returns, or the raw payload when the
            feature declares none.
        """
        entry = self._entry(feature)
        responses = self._exchange(entry["addr"], OP_GET)
        payload = responses[0].payload if responses else b""
        parser = entry.get("parser")
        return parser(payload) if parser else payload

    def get_raw(self, feature):
        """GET a feature and return the unparsed payload."""
        entry = self._entry(feature)
        responses = self._exchange(entry["addr"], OP_GET)
        return responses[0].payload if responses else b""

    def set(self, feature, *args, **kwargs):
        """SETGET a feature, building the payload with its builder.

        :raises ~src.protocol.errors.BmapUnsupported: when the
            feature has no builder, which is how read-only ones are marked.
        """
        entry = self._entry(feature)
        builder = entry.get("builder")
        if builder is None:
            raise BmapUnsupported("%r is read-only on %s" % (feature, self.NAME))
        drain = kwargs.pop("drain", False)
        return self._exchange(entry["addr"], OP_SETGET,
                              builder(*args, **kwargs), drain=drain)

    def start(self, feature, *args, **kwargs):
        """START a feature, building the payload with its builder if it has one.

        A feature with no builder takes its payload bytes directly, which is
        how the raw one-byte triggers -- power, pairing -- are sent.
        """
        entry = self._entry(feature)
        builder = entry.get("builder")
        drain = kwargs.pop("drain", False)
        payload = builder(*args, **kwargs) if builder else (args[0] if args else b"")
        return self._exchange(entry["addr"], OP_START, payload, drain=drain)

    def raw(self, hex_str):
        """Send hand-written bytes and return every reply."""
        data = bytes.fromhex(hex_str.replace(" ", ""))
        return codec.parse_all(self._link.send_recv(data, drain=True))

    def safe(self, method, default=None):
        """Read something optional -- a refused GET should not sink a status."""
        try:
            return method()
        except BmapError:
            return default

    # -- status --------------------------------------------------------------

    def status_rows(self):
        """The rows ``status`` prints, as ``(label, value)`` pairs.

        Each name in :attr:`STATUS_ROWS` is looked up in the shared
        :data:`src.devices.status.ROWS` and then in this model's own
        :attr:`ROWS`. A renderer that returns ``None`` -- because the device
        declined to answer, or has no such feature -- is left out.
        """
        renderers = dict(status.ROWS)
        renderers.update(self.ROWS)
        rows = []
        for name in self.STATUS_ROWS:
            render = renderers.get(name)
            if render is None:
                raise KeyError("%s asks for an unknown status row %r"
                               % (type(self).__name__, name))
            rendered = render(self)
            if rendered is not None:
                rows.append(rendered)
        return rows

    # -- lifecycle -----------------------------------------------------------

    def close(self):
        """Close the underlying link."""
        self._link.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
