"""The channel to the desktop app that started the agent: JSON lines on stdin and stdout.

No port, no token: only the process that launched the agent can talk to it.

The app sends requests::

    {"id": 1, "method": "settings", "params": {"device_id": "qc45-acbf718224e0"}}

and gets one answer per request, ``{"id": 1, "result": ...}`` or
``{"id": 1, "error": {"status": 409, "message": "..."}}``. The agent also
pushes events on its own: ``{"event": "devices", "data": {...}}`` after every
poll, so the app shows each reading as soon as it is taken.

Methods:

``devices``
    every device seen and its last battery reading
``settings`` ``{device_id}``
    every setting the model has, read live
``apply`` ``{device_id, changes}``
    change some settings, then read them all back
``action`` ``{device_id, action, params}``
    a one-shot action (play, power off...)
``refresh``
    poll every device now
``watch``
    the app is open and visible: poll every second for the next seconds
    (sent again every few seconds while it stays so)

Logs go to stderr: stdout is the channel. When the app closes stdin (it quit),
the agent stops.
"""

import asyncio
import json
import sys
import threading
from typing import Any

from . import controls
from .errors import DeviceRequestError
from .manager import DeviceManager


class Channel:
    def __init__(self, manager: DeviceManager, logs) -> None:
        self.manager = manager
        self.logs = logs
        self._lock = threading.Lock()
        self.closed = asyncio.Event()

    # -- output ----------------------------------------------------------------

    def send(self, message: dict) -> None:
        line = json.dumps(message, separators=(",", ":"), default=str)
        with self._lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def devices_payload(self) -> dict:
        m = self.manager
        return {
            "devices": [state.to_dict() for state in m.all()],
            "polled_at": m.polled_at.isoformat(timespec="seconds") if m.polled_at else None,
            "poll_interval": m.interval,
        }

    def push_devices(self) -> None:
        self.send({"event": "devices", "data": self.devices_payload()})

    # -- requests ----------------------------------------------------------------

    async def handle(self, method: str, params: dict) -> Any:
        m = self.manager
        if method == "devices":
            return self.devices_payload()
        if method == "watch":
            m.watch()
            return None
        if method == "refresh":
            await m.refresh()
            return self.devices_payload()

        if method not in ("settings", "apply", "action"):
            raise ValueError(f"Unknown method '{method}'.")
        device_id = str(params.get("device_id", ""))
        vendor = controls.for_vendor(m.get(device_id).found.vendor)
        if method == "settings":
            return await m.run(device_id, vendor.read)
        if method == "apply":
            changes = params.get("changes")
            if not isinstance(changes, dict) or not changes:
                raise ValueError("Send at least one setting to change.")

            def apply_then_read(dev):
                vendor.apply(dev, changes)
                return vendor.read(dev)

            return await m.run(device_id, apply_then_read)
        # action
        action = str(params.get("action", ""))
        action_params = params.get("params") or {}
        await m.run(device_id, lambda dev: vendor.act(dev, action, action_params))
        return None

    async def answer(self, request: dict) -> None:
        request_id = request.get("id")
        try:
            result = await self.handle(str(request.get("method", "")), request.get("params") or {})
            self.send({"id": request_id, "result": result})
        except ValueError as e:  # input the device does not take
            self.send({"id": request_id, "error": {"status": 400, "message": str(e)}})
        except DeviceRequestError as e:
            self.send({"id": request_id, "error": {"status": e.status, "message": str(e)}})
        except Exception as e:
            self.logs.error(f"Request {request.get('method')} failed: {e!r}")
            self.send({"id": request_id, "error": {"status": 500, "message": str(e) or e.__class__.__name__}})

    # -- input -------------------------------------------------------------------

    def start(self) -> None:
        """Read stdin in a thread (asyncio can't read a pipe on Windows) and answer on the loop."""
        loop = asyncio.get_running_loop()

        def read() -> None:
            for raw in sys.stdin.buffer:
                line = raw.strip()
                if not line:
                    continue
                try:
                    request = json.loads(line)
                except json.JSONDecodeError:
                    self.logs.warning(f"Ignored a line that isn't JSON: {line[:80]!r}")
                    continue
                if isinstance(request, dict):
                    loop.call_soon_threadsafe(lambda r=request: asyncio.ensure_future(self.answer(r)))
            loop.call_soon_threadsafe(self.closed.set)  # the app is gone

        threading.Thread(target=read, name="ipc-stdin", daemon=True).start()
        self.manager.listeners.append(self.push_devices)
        self.send({"event": "ready", "data": {"poll_interval": self.manager.interval}})
