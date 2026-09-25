"""The exception hierarchy every layer raises and the CLI catches.

One base class, :class:`BmapError`, so a caller that only wants to know
"did this work" can catch a single thing, with narrower subclasses for the
cases worth telling apart -- a link that never opened, a device that stayed
silent, a device that answered with a refusal, and a feature this model
simply does not have.
"""


class BmapError(Exception):
    """Base for every BMAP failure."""


class BmapConnectionError(BmapError):
    """The RFCOMM link could not be opened, or broke mid-exchange."""


class BmapTimeoutError(BmapError):
    """The device did not answer in time."""


class BmapDeviceError(BmapError):
    """The device answered with an ERROR packet.

    :param message: human-readable description, usually including the packet.
    :param error_code: the raw error byte, looked up in
        :data:`~src.protocol.codec.ERROR_NAMES`.
    """

    def __init__(self, message, error_code=None):
        BmapError.__init__(self, message)
        self.error_code = error_code


class BmapNotFoundError(BmapError):
    """No supported device was found."""


class BmapUnsupported(BmapError):
    """This model does not have the feature that was asked for."""
