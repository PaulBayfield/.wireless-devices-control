"""Linux: paired devices, from ``bluetoothctl``.

BlueZ already knows everything this client needs -- the address, the name,
whether the device is connected, and the vendor and product ids inside the
modalias -- so there is nothing to join up here and no ctypes. Shelling out
to a host tool is the same bargain :mod:`src.core.media` makes on
Windows: a program that is already installed, rather than a dependency.
"""

import re
import subprocess

#: Only a literal address is ever handed back to ``bluetoothctl``.
MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")

#: ``Modalias: bluetooth:v009Ep4039d0100`` -- vendor then product.
_MODALIAS_RE = re.compile(
    r"Modalias:\s*bluetooth:v([0-9A-Fa-f]{4})p([0-9A-Fa-f]{4})")


def paired_devices():
    """Every paired device as ``(mac, name, vendor_id, product_id, connected)``.

    Devices ``bluetoothctl`` reports without a modalias are left out: with no
    vendor id there is no way to tell a Bose device from anything else.
    Returns an empty list when ``bluetoothctl`` is missing or hangs.
    """
    found = []
    listing = _run(["bluetoothctl", "devices", "Paired"], timeout=5)
    if listing is None:
        return found

    for line in listing.strip().splitlines():
        parts = line.split(None, 2)
        if len(parts) < 2 or not MAC_RE.match(parts[1]):
            continue
        mac = parts[1]
        info = _run(["bluetoothctl", "info", mac], timeout=3)
        if info is None:
            continue
        match = _MODALIAS_RE.search(info)
        if not match:
            continue
        found.append((mac, parts[2] if len(parts) > 2 else "",
                      int(match.group(1), 16), int(match.group(2), 16),
                      "Connected: yes" in info))
    return found


def _run(command, timeout):
    """Run a ``bluetoothctl`` command, or return ``None`` if it will not."""
    try:
        return subprocess.run(command, capture_output=True, text=True,
                              timeout=timeout).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
