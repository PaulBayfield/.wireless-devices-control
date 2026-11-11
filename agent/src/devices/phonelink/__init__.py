"""Phones linked through Phone Link (Windows' "Mobile devices"), read-only.

Phone Link keeps the linked phone's status on disk for the Start menu's
companion panel: an Adaptive Card (``StartMenuCompanion.json``) whose status
row carries the battery and whether the phone is connected to this PC, as
the text the panel shows. The phone's name and model come from Phone Link's
device list (``DeviceMetadataStorage.json``). Nothing talks to the phone:
this reads what Phone Link already fetched, so it needs Phone Link running
and linked, and sees one phone -- the one the panel shows.

The panel's text is localised; the patterns below cover English and French.
"""

import json
import os
import re
import sys
from pathlib import Path

from src.core.battery import Battery, ChargeState
from src.core.device import Device, FoundDevice
from src.core.errors import DeviceError

VENDOR = "phonelink"

_PACKAGE = "Microsoft.YourPhone_8wekyb3d8bbwe"
_BATTERY = re.compile(r"batter", re.I)
_PERCENT = re.compile(r"(\d{1,3})\s*%")
_CHARGING = re.compile(r"en charge|charging", re.I)
_DISCHARGING = re.compile(r"restante?|remaining|left", re.I)
_DISCONNECTED = re.compile(r"d[ée]connect|disconnected|not connected|non connect", re.I)
_CONNECTED = re.compile(r"connect[ée]", re.I)


class PhoneLinkError(DeviceError):
    """Phone Link's files are missing or not in the shape expected."""


def _package_dir() -> Path | None:
    local = os.environ.get("LOCALAPPDATA")
    if sys.platform != "win32" or not local:
        return None
    path = Path(local) / "Packages" / _PACKAGE
    return path if path.is_dir() else None


def _card_labels() -> list[str]:
    """Every tooltip and alt text of the Start menu card, in order."""
    package = _package_dir()
    card = package / "LocalState" / "StartMenu" / "StartMenuCompanion.json" if package else None
    if card is None or not card.is_file():
        raise PhoneLinkError("Phone Link has no linked phone on this PC.")
    try:
        data = json.loads(card.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        raise PhoneLinkError(f"Could not read Phone Link's status: {e}") from e

    labels = []

    def walk(node):
        if isinstance(node, dict):
            for key in ("tooltip", "altText"):
                if isinstance(node.get(key), str):
                    labels.append(node[key])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return labels


def read_status() -> tuple[Battery, bool]:
    """The phone's battery, and whether Phone Link says it is connected."""
    labels = _card_labels()
    battery = None
    for label in labels:
        match = _PERCENT.search(label)
        if _BATTERY.search(label) and match:
            state = (ChargeState.CHARGING if _CHARGING.search(label)
                     else ChargeState.DISCHARGING if _DISCHARGING.search(label)
                     else ChargeState.UNKNOWN)
            battery = Battery(int(match.group(1)), state)
            break
    if battery is None:
        raise PhoneLinkError("Phone Link shows no battery level for the phone.")
    connected = any(_CONNECTED.search(label) and not _DISCONNECTED.search(label)
                    for label in labels)
    return battery, connected


def read_identity() -> tuple[str, str, str]:
    """``(device id, display name, model)`` of the linked phone."""
    package = _package_dir()
    path = package / "LocalCache" / "DeviceMetadataStorage.json" if package else None
    try:
        devices = json.loads(path.read_text(encoding="utf-8-sig"))["DeviceMetadatas"]
    except (AttributeError, OSError, ValueError, KeyError) as e:
        raise PhoneLinkError(f"Could not read Phone Link's device list: {e}") from e
    for device_id, entries in devices.items():
        linked = [e for e in entries if e.get("IsLinked")]
        if linked:
            inner = (linked[0].get("Metadata") or {}).get("Metadata") or {}
            model = inner.get("ModelName") or "Android phone"
            return device_id, inner.get("DisplayName") or model, model
    raise PhoneLinkError("Phone Link has no linked phone.")


class PhoneLinkPhone(Device):
    """The phone Phone Link shows. Every read goes back to Phone Link's files."""

    VENDOR = VENDOR
    KIND = "phone"
    KEY = "phone"
    NAME = "Android phone"

    def name(self) -> str:
        return read_identity()[1]

    def battery(self) -> Battery:
        return read_status()[0]

    def model(self) -> str:
        return read_identity()[2]

    def close(self) -> None:
        pass


def scan() -> list[FoundDevice]:
    """The linked phone, if Phone Link has one; nothing otherwise."""
    if _package_dir() is None:
        return []
    try:
        device_id, name, _model = read_identity()
        _battery, connected = read_status()
    except PhoneLinkError:
        return []
    return [FoundDevice(f"phone-{device_id.lower()}", PhoneLinkPhone, name,
                        "Phone Link", connected, PhoneLinkPhone)]


__all__ = ["VENDOR", "PhoneLinkError", "PhoneLinkPhone", "read_identity",
           "read_status", "scan"]
