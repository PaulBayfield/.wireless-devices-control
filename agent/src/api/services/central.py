"""The link to devices.bayfield.dev, the server that keeps the data of every PC.

Devices are controlled here, through this computer's API; the server only
keeps their data, so it is all there whichever computer you use.

After every poll (and at least every poll interval: a heartbeat),
:meth:`CentralLink.report` sends the devices and the battery runs the server
has not acknowledged yet. The local history is the queue: the cursor only
moves once the server has answered, so a computer that was offline catches up
at its next report, and the first report after an upgrade backfills the whole
history, in batches.

It only connects out, so it works behind any router.

The agent authenticates with its own key (``AGENT_KEY``), created in the app
under Settings → Computers. Only its hash is stored on the server.

HTTP is done with the standard library in a thread: two requests every poll
do not justify another dependency.
"""

import asyncio
import json
import platform
import socket
import urllib.error
import urllib.request
from typing import Any

from .history import BatteryHistory
from .manager import DeviceManager

#: Runs sent in one report; a backlog is drained in several, back to back.
_BATCH = 1000
#: Seconds between two reports at most often: polls run every second while the app is open.
_REPORT_EVERY = 10
#: Name of the cursor in the history database.
_CURSOR = "central_runs"
AGENT_VERSION = "1.0.0"


class CentralError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class CentralLink:
    """Reports every poll to devices.bayfield.dev.

    :param url: the server, e.g. ``https://devices.bayfield.dev``.
    :param key: this agent's key.
    :param name: how this PC is called in the app; the hostname by default.
    """

    def __init__(self, url: str, key: str, name: str | None, manager: DeviceManager,
                 history: BatteryHistory, logs) -> None:
        self.url = url.rstrip("/")
        self.key = key
        self.name = name or socket.gethostname()
        self.manager = manager
        self.history = history
        self.logs = logs
        self._polled = asyncio.Event()
        manager.listeners.append(self._polled.set)

    # -- HTTP -----------------------------------------------------------------

    def _request(self, method: str, path: str, body: Any = None, timeout: float = 20) -> Any:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            f"{self.url}/api/agent{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "User-Agent": f"devices-agent/{AGENT_VERSION}",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - our own server
                raw = response.read()
        except urllib.error.HTTPError as e:
            try:
                message = json.loads(e.read()).get("error") or e.reason
            except Exception:
                message = e.reason
            raise CentralError(e.code, str(message)) from e
        return json.loads(raw) if raw else None

    async def _call(self, method: str, path: str, body: Any = None, timeout: float = 20) -> Any:
        return await asyncio.to_thread(self._request, method, path, body, timeout)

    # -- reports --------------------------------------------------------------

    def _host(self) -> dict:
        return {
            "name": self.name,
            "platform": f"{platform.system()} {platform.release()}".strip(),
            "agent_version": AGENT_VERSION,
            "poll_interval": self.manager.interval,
        }

    async def report(self) -> None:
        """Send the devices, then every run the server has not acknowledged."""
        polled_at = self.manager.polled_at
        devices = [state.to_dict() for state in self.manager.all()]
        for _ in range(50):  # at most 50 000 runs per poll: a 90-day backlog fits easily
            cursor = await asyncio.to_thread(self.history.cursor, _CURSOR)
            runs = await asyncio.to_thread(self.history.runs_since, cursor, _BATCH)
            await self._call("POST", "/report", {
                "host": self._host(),
                "polled_at": polled_at.isoformat(timespec="seconds") if polled_at else None,
                "devices": devices,
                "runs": runs,
            })
            if runs:
                await asyncio.to_thread(self.history.set_cursor, _CURSOR, runs[-1]["ended_at"])
            if len(runs) < _BATCH:
                return
            devices = []  # sent with the first batch already

    async def report_forever(self) -> None:
        """Report after a poll (at most every :data:`_REPORT_EVERY` s), and at least every poll interval."""
        backoff = 5
        loop = asyncio.get_running_loop()
        last = 0.0
        while True:
            # Polls come every second while the app is open: the server doesn't need them all.
            await asyncio.sleep(max(_REPORT_EVERY - (loop.time() - last), 0))
            try:
                await asyncio.wait_for(self._polled.wait(), timeout=self.manager.interval)
            except TimeoutError:
                pass
            self._polled.clear()
            last = loop.time()
            try:
                await self.report()
                backoff = 5
            except asyncio.CancelledError:
                raise
            except CentralError as e:
                self.logs.warning(f"devices.bayfield.dev refused the report ({e.status}): {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)
            except Exception as e:  # offline, DNS... try again at the next poll
                self.logs.warning(f"Could not reach devices.bayfield.dev: {e!r}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 300)
