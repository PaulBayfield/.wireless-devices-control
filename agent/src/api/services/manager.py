"""The one owner of the hardware.

Every device exchange in the API goes through :class:`DeviceManager`:

- A background task polls every vendor at a fixed interval, and keeps the
  latest battery reading of each device in memory -- along with when it was
  taken, so a device that has since gone to sleep still shows its last
  known level rather than disappearing.
- Device code is blocking (sockets, hidapi), so it runs in a thread, never
  on the event loop.
- A lock per vendor keeps two exchanges from ever sharing a link: the
  poller and a request can both want the Bluetooth radio, and a Bose socket
  or a HID++ reply stream only makes sense with one conversation at a time.
  Vendors are independent hardware, so they do not wait on each other.

The devices themselves are only held in memory, and a restart discovers
them again from scratch. Battery readings are the exception: each one is
also handed to :class:`~.history.BatteryHistory`, which keeps them on disk.
"""

import asyncio
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any

from src.core import Battery, Device, DeviceError, FoundDevice
from src.devices import VENDORS

from ..exceptions.devices import DeviceNotConnected, DeviceNotFound, DeviceUnreachable
from .history import BatteryHistory

#: Seconds the app counts as open after its last :meth:`DeviceManager.watch`.
WATCH_TTL = 10
#: Seconds between two discoveries while the app is open (batteries are read every poll).
SCAN_EVERY = 30
#: At or below this, a battery is watched more closely.
LOW_BATTERY = 20


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(moment: datetime | None) -> str | None:
    return moment.isoformat(timespec="seconds") if moment else None


@dataclass
class DeviceState:
    """What the API knows about one device, between polls."""

    found: FoundDevice
    battery: Battery | None = None
    #: When :attr:`battery` was read.
    battery_at: datetime | None = None
    #: The last time the device answered.
    seen_at: datetime | None = None
    #: Why the last attempt to reach it failed, cleared on success.
    error: str | None = None

    def to_dict(self) -> dict:
        found = self.found
        return {
            "id": found.id,
            "vendor": found.vendor,
            "key": found.key,
            "kind": found.kind,
            "model": found.model,
            "name": found.name,
            "address": found.address,
            "connected": found.connected,
            "battery": None if self.battery is None else {
                "percent": self.battery.percent,
                "state": self.battery.state.value,
                "charging": self.battery.charging,
                "millivolts": self.battery.millivolts,
            },
            "battery_updated_at": _iso(self.battery_at),
            "last_seen_at": _iso(self.seen_at),
            "error": self.error,
        }


def _read_battery(found: FoundDevice) -> Battery:
    with found.open() as dev:
        return dev.battery()


def _call(found: FoundDevice, fn: Callable[[Device], Any]) -> Any:
    with found.open() as dev:
        return fn(dev)


class DeviceManager:
    """Discovery, battery polling, and serialized access to every device.

    The polling rate adapts, to keep the data accurate without draining the
    devices' batteries over Bluetooth:

    - while the Devices app is open on this computer (it calls :meth:`watch`
      every few seconds), batteries are read every *active_interval* second,
      and discovery only runs every :data:`SCAN_EVERY` seconds;
    - otherwise every *min_interval* seconds while something is moving
      (a device charging, low, or whose level just changed), and every
      *interval* seconds when everything is steady.

    :param interval: seconds between two polls when every battery is steady (the longest).
    :param logs: the app logger.
    :param history: where every battery reading is recorded.
    :param min_interval: seconds between two polls while a battery is moving.
    :param active_interval: seconds between two polls while the app is open.
    """

    def __init__(self, interval: int, logs, history: BatteryHistory, min_interval: float | None = None,
                 active_interval: float = 1) -> None:
        self.interval = interval
        self.min_interval = min(min_interval or interval, interval)
        self.active_interval = active_interval
        self.logs = logs
        self.history = history
        self.devices: dict[str, DeviceState] = {}
        #: When the last poll finished.
        self.polled_at: datetime | None = None
        self._locks = {vendor.VENDOR: asyncio.Lock() for vendor in VENDORS}
        self._refresh_lock = asyncio.Lock()
        #: Called after every poll, e.g. to report it to devices.bayfield.dev.
        self.listeners: list[Callable[[], None]] = []
        #: Until when the app counts as open (event loop time), see :meth:`watch`.
        self._watched_until = 0.0
        self._wake = asyncio.Event()
        self._scanned_at = 0.0
        #: Whether a battery moved at the last poll (level or charging state).
        self._moved = False

    # -- polling -------------------------------------------------------------

    def watch(self) -> None:
        """The app is open on this computer: poll fast for the next :data:`WATCH_TTL` seconds."""
        idle = not self.watched
        self._watched_until = asyncio.get_running_loop().time() + WATCH_TTL
        if idle:
            self._wake.set()  # cut the current idle wait short

    @property
    def watched(self) -> bool:
        return asyncio.get_running_loop().time() < self._watched_until

    def next_interval(self) -> float:
        """Seconds until the next poll: fast while watched, then by how much the batteries move."""
        if self.watched:
            return self.active_interval
        moving = self._moved or any(
            s.found.connected and s.battery is not None
            and (s.battery.state.value == "charging" or bool(s.battery.charging)
                 or (s.battery.percent is not None and s.battery.percent <= LOW_BATTERY))
            for s in self.devices.values()
        )
        return self.min_interval if moving else self.interval

    async def run_forever(self) -> None:
        """Poll now, then again after :meth:`next_interval`, until cancelled."""
        loop = asyncio.get_running_loop()
        while True:
            started = loop.time()
            # Discovery (Bluetooth enumeration, the HID receiver) is the slow part: while
            # watched, only the batteries of known devices are read in between.
            full = not self.watched or started - self._scanned_at >= SCAN_EVERY
            try:
                await self.refresh(scan=full)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # keep polling whatever one round did
                self.logs.error(f"Poll failed: {e!r}")
            self._wake.clear()
            wait = max(self.next_interval() - (loop.time() - started), 0)
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=wait)
            except TimeoutError:
                pass

    async def refresh(self, scan: bool = True) -> None:
        """Read every connected battery, rediscovering every vendor first unless *scan* is false.

        A refresh already running is waited for rather than doubled.
        """
        if self._refresh_lock.locked():
            async with self._refresh_lock:
                return
        async with self._refresh_lock:
            before = {i: (s.battery.percent, s.battery.state) for i, s in self.devices.items() if s.battery}
            await asyncio.gather(*(self._refresh_vendor(v, scan) for v in VENDORS))
            if scan:
                self._scanned_at = asyncio.get_running_loop().time()
            self.polled_at = _now()
            after = {i: (s.battery.percent, s.battery.state) for i, s in self.devices.items() if s.battery}
            self._moved = any(before.get(i, v) != v for i, v in after.items())
        for listener in self.listeners:
            listener()

    async def _refresh_vendor(self, vendor, scan: bool = True) -> None:
        async with self._locks[vendor.VENDOR]:
            if scan:
                try:
                    found = await asyncio.to_thread(vendor.scan)
                except (DeviceError, OSError) as e:
                    self.logs.warning(f"{vendor.VENDOR}: discovery failed: {e}")
                    return
            else:
                found = [s.found for s in self.devices.values()
                         if s.found.vendor == vendor.VENDOR and s.found.connected]

            for item in found:
                state = self.devices.setdefault(item.id, DeviceState(item))
                state.found = item
                if not item.connected:
                    continue
                try:
                    state.battery = await asyncio.to_thread(_read_battery, item)
                except DeviceError as e:
                    state.error = str(e)
                    continue
                state.battery_at = state.seen_at = _now()
                state.error = None
                try:
                    await asyncio.to_thread(self.history.record, item.id, state.battery, state.battery_at)
                except sqlite3.Error as e:  # a reading not kept is no reason to stop polling
                    self.logs.warning(f"{item.name}: battery reading not recorded: {e}")

            if not scan:
                return

            # Seen before, gone now (a Logitech mouse asleep): keep it, with
            # its last reading, but say it is not reachable.
            current = {item.id for item in found}
            for state in self.devices.values():
                if state.found.vendor == vendor.VENDOR and state.found.id not in current:
                    state.found = replace(state.found, connected=False)

    # -- access --------------------------------------------------------------

    def get(self, device_id: str) -> DeviceState:
        """The state of one device.

        :raises DeviceNotFound: when no poll has seen it.
        """
        state = self.devices.get(device_id)
        if state is None:
            raise DeviceNotFound(f"No device with id '{device_id}'.")
        return state

    def all(self) -> list[DeviceState]:
        """Every device seen since startup, by vendor then name."""
        return sorted(self.devices.values(),
                      key=lambda s: (s.found.vendor, s.found.name.lower()))

    async def run(self, device_id: str, fn: Callable[[Device], Any]) -> Any:
        """Open the device, call ``fn(device)`` in a thread, close it.

        A successful exchange marks the device as seen.

        :raises DeviceNotFound: for an unknown id.
        :raises DeviceNotConnected: when discovery says it is not reachable.
        :raises DeviceUnreachable: when it does not answer, or refuses.
        :raises ValueError: from *fn*, for input the device will not take.
        """
        state = self.get(device_id)
        if not state.found.connected:
            raise DeviceNotConnected(f"{state.found.name} is not connected.")
        async with self._locks[state.found.vendor]:
            try:
                result = await asyncio.to_thread(_call, state.found, fn)
            except DeviceError as e:
                state.error = str(e)
                raise DeviceUnreachable(f"{state.found.name}: {e}") from e
        state.seen_at = _now()
        state.error = None
        return result
