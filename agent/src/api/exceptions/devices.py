from sanic.exceptions import SanicException


class DeviceNotFound(SanicException):
    """No device with that id has been discovered."""

    status_code = 404
    quiet = True


class DeviceNotConnected(SanicException):
    """The device is known but not reachable right now (off, asleep, elsewhere)."""

    status_code = 409
    quiet = True


class InvalidInput(SanicException):
    """The request asked for something the device does not have or accept."""

    status_code = 400
    quiet = True


class DeviceUnreachable(SanicException):
    """The device was expected to answer and did not, or answered with an error."""

    status_code = 502
    quiet = True
