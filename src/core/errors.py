"""The one exception every vendor's errors derive from.

Each vendor keeps its own hierarchy -- ``BmapError`` for Bose, ``HidppError``
for Logitech -- with the distinctions that matter for that protocol. Code that
talks to devices of any vendor, like the server or the battery overview,
catches :class:`DeviceError` and treats the device as unreachable.
"""


class DeviceError(Exception):
    """A device could not be found, reached, or did not answer as expected."""
