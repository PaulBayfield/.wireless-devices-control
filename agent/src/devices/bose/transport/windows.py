"""Windows: paired devices and the local radio, through ctypes and winreg.

Two sources are needed, because neither one has the whole picture:

* ``BluetoothAPIs`` (bthprops.cpl) is authoritative on pairing -- address,
  friendly name, and whether the device is connected right now -- but does
  not report vendor or product ids.
* The ``BTHENUM`` PnP registry key carries those ids, which is how a Bose
  QC45 is told apart from any other paired headset.

:func:`paired_devices` and :func:`vendor_product_ids` are joined up in
:mod:`src.devices.bose.transport.discovery`; :func:`radio_address` is what lets
:mod:`src.core.media` say whether *this* PC is the one playing.

Both sources are read with the standard library, so this stays
dependency-free. Importing this module only works on Windows -- it is
imported lazily, behind a ``sys.platform`` check.
"""

import ctypes
import re
import winreg
from ctypes import wintypes

# -- BluetoothAPIs structures (bluetoothapis.h) ------------------------------


class _BluetoothAddress(ctypes.Union):
    _fields_ = [
        ("ullLong", ctypes.c_ulonglong),
        ("rgBytes", ctypes.c_ubyte * 6),
    ]


class _SystemTime(ctypes.Structure):
    _fields_ = [
        (name, wintypes.WORD) for name in (
            "wYear", "wMonth", "wDayOfWeek", "wDay",
            "wHour", "wMinute", "wSecond", "wMilliseconds",
        )
    ]


class _BluetoothDeviceInfo(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("Address", _BluetoothAddress),
        ("ulClassofDevice", wintypes.ULONG),
        ("fConnected", wintypes.BOOL),
        ("fRemembered", wintypes.BOOL),
        ("fAuthenticated", wintypes.BOOL),
        ("stLastSeen", _SystemTime),
        ("stLastUsed", _SystemTime),
        ("szName", wintypes.WCHAR * 248),
    ]


class _BluetoothDeviceSearchParams(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("fReturnAuthenticated", wintypes.BOOL),
        ("fReturnRemembered", wintypes.BOOL),
        ("fReturnUnknown", wintypes.BOOL),
        ("fReturnConnected", wintypes.BOOL),
        ("fIssueInquiry", wintypes.BOOL),
        ("cTimeoutMultiplier", ctypes.c_ubyte),
        ("hRadio", wintypes.HANDLE),
    ]


def _load_bluetooth_api():
    """Load bthprops.cpl with explicit prototypes, or return None.

    The find handle is pointer-sized; without an explicit restype ctypes
    truncates it to a C int and the next call faults.
    """
    for name in ("bthprops.cpl", "BluetoothAPIs.dll"):
        try:
            lib = ctypes.WinDLL(name)
        except OSError:
            continue
        handle = wintypes.HANDLE
        lib.BluetoothFindFirstDevice.restype = handle
        lib.BluetoothFindFirstDevice.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        lib.BluetoothFindNextDevice.restype = wintypes.BOOL
        lib.BluetoothFindNextDevice.argtypes = [handle, ctypes.c_void_p]
        lib.BluetoothFindDeviceClose.restype = wintypes.BOOL
        lib.BluetoothFindDeviceClose.argtypes = [handle]
        return lib
    return None


def paired_devices():
    """Yield ``(mac, name, connected)`` for every paired Bluetooth device.

    Returns an empty list when the machine has no Bluetooth stack or radio.
    """
    lib = _load_bluetooth_api()
    if lib is None:
        return []

    params = _BluetoothDeviceSearchParams()
    params.dwSize = ctypes.sizeof(params)
    params.fReturnAuthenticated = True
    params.fReturnRemembered = True
    params.fReturnConnected = True
    params.fReturnUnknown = False
    params.fIssueInquiry = False      # no radio scan: only what is already paired
    params.cTimeoutMultiplier = 0
    params.hRadio = None

    info = _BluetoothDeviceInfo()
    info.dwSize = ctypes.sizeof(info)

    found = []
    handle = lib.BluetoothFindFirstDevice(ctypes.byref(params), ctypes.byref(info))
    if not handle:
        return found
    try:
        while True:
            octets = info.Address.rgBytes
            # rgBytes is little-endian; the display form is the reverse.
            mac = ":".join("%02X" % octets[i] for i in range(5, -1, -1))
            found.append((mac, info.szName, bool(info.fConnected)))

            nxt = _BluetoothDeviceInfo()
            nxt.dwSize = ctypes.sizeof(nxt)
            if not lib.BluetoothFindNextDevice(handle, ctypes.byref(nxt)):
                break
            info = nxt
    finally:
        lib.BluetoothFindDeviceClose(handle)
    return found


class _RadioInfo(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("address", ctypes.c_ulonglong),
        ("szName", wintypes.WCHAR * 248),
        ("ulClassofDevice", wintypes.ULONG),
        ("lmpSubversion", wintypes.USHORT),
        ("manufacturer", wintypes.USHORT),
    ]


class _FindRadioParams(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD)]


def radio_address():
    """This PC's own Bluetooth address, or None.

    Worth knowing because a device reports the address of whatever it is
    connected to: matching that against this tells you whether this PC is
    the one playing.
    """
    lib = _load_bluetooth_api()
    if lib is None:
        return None
    # Same trap as the device finder: these handles are pointer-sized, and
    # without explicit prototypes ctypes truncates them to a C int.
    lib.BluetoothFindFirstRadio.restype = wintypes.HANDLE
    lib.BluetoothFindFirstRadio.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    lib.BluetoothFindRadioClose.restype = wintypes.BOOL
    lib.BluetoothFindRadioClose.argtypes = [wintypes.HANDLE]
    lib.BluetoothGetRadioInfo.restype = wintypes.DWORD
    lib.BluetoothGetRadioInfo.argtypes = [wintypes.HANDLE, ctypes.c_void_p]

    params = _FindRadioParams()
    params.dwSize = ctypes.sizeof(params)
    handle = wintypes.HANDLE()
    finder = lib.BluetoothFindFirstRadio(ctypes.byref(params), ctypes.byref(handle))
    if not finder:
        return None
    try:
        info = _RadioInfo()
        info.dwSize = ctypes.sizeof(info)
        if lib.BluetoothGetRadioInfo(handle, ctypes.byref(info)) != 0:
            return None
        octets = info.address.to_bytes(6, "little")
        return ":".join("%02X" % b for b in reversed(octets))
    finally:
        lib.BluetoothFindRadioClose(finder)


# -- BTHENUM registry (vendor/product ids) -----------------------------------

# e.g. BTHENUM\{0000110C-...}_VID&0001009E_PID&4039
#                             ^^^^ ^^^^     ^^^^
#                           source vendor   product
# Source 0001 is a Bluetooth SIG company id, 0002 a USB vendor id.
_VID_PID_RE = re.compile(
    r"VID&([0-9A-Fa-f]{4})([0-9A-Fa-f]{4})_PID&([0-9A-Fa-f]{4})"
)
# ...\8&313AC306&0&ACBF718224E0_C00000000
_INSTANCE_MAC_RE = re.compile(r"&([0-9A-Fa-f]{12})(?:_|$)")

_BTHENUM = r"SYSTEM\CurrentControlSet\Enum\BTHENUM"


def _subkeys(key):
    index = 0
    while True:
        try:
            yield winreg.EnumKey(key, index)
        except OSError:
            return
        index += 1


def vendor_product_ids():
    """Map a separator-free upper-case MAC to ``(vendor_id, product_id)``.

    Reading this key needs no elevation. An unreadable key returns an empty
    map, which simply means discovery finds nothing and the caller falls
    back to an explicit ``--mac``.
    """
    ids = {}
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, _BTHENUM) as root:
            for service in _subkeys(root):
                match = _VID_PID_RE.search(service)
                if not match:
                    continue
                vid = int(match.group(2), 16)
                pid = int(match.group(3), 16)
                try:
                    with winreg.OpenKey(root, service) as service_key:
                        for instance in _subkeys(service_key):
                            found = _INSTANCE_MAC_RE.search(instance)
                            if found:
                                ids[found.group(1).upper()] = (vid, pid)
                except OSError:
                    continue
    except OSError:
        return {}
    return ids
