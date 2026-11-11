"""Finding a Bose device and talking to it over an RFCOMM socket.

:mod:`~.transport.rfcomm`
    the socket itself: connect, exchange, close
:mod:`~.transport.discovery`
    what is paired, and which of it we can drive
:mod:`~.transport.session`
    finding a device and opening the right channel
:mod:`~.transport.windows`
    Windows: BluetoothAPIs and the BTHENUM registry
:mod:`~.transport.linux`
    Linux: ``bluetoothctl``

Nothing here knows about any particular model -- it resolves whatever it
finds through :mod:`src.devices.bose.models` -- and everything is standard
library, so the client installs with no dependencies at all.
"""

from .discovery import (
    BOSE_BT_SIG_VID,
    BOSE_USB_VID,
    bose_devices,
    connected_devices,
    supported_devices,
)
from .rfcomm import RfcommTransport
from .session import connect, discover, open_channel, open_link, speaks_bmap

__all__ = [
    "BOSE_BT_SIG_VID", "BOSE_USB_VID", "RfcommTransport", "bose_devices",
    "connect", "connected_devices", "discover", "open_channel", "open_link",
    "speaks_bmap", "supported_devices",
]
