"""Why a request about a device failed, with the HTTP-like status the app shows it as."""


class DeviceRequestError(Exception):
    status = 500


class DeviceNotFound(DeviceRequestError):
    """No device with that id has been discovered."""

    status = 404


class DeviceNotConnected(DeviceRequestError):
    """The device is known but not reachable right now (off, asleep, elsewhere)."""

    status = 409


class DeviceUnreachable(DeviceRequestError):
    """The device was expected to answer and did not, or answered with an error."""

    status = 502
