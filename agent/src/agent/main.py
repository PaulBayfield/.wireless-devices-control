"""The agent: polls the devices of this computer, keeps their history, and sends it to
devices.bayfield.dev.

    uv run __main__.py serve          on its own (a computer without the desktop app)
    devices-agent.exe serve --ipc     started by the desktop app, which talks to it on stdin/stdout

Configured from the environment (and ``.env`` when run on its own), see ``.env.example``.
"""

import asyncio
import contextlib
from os import environ

from dotenv import load_dotenv

from .central import CentralLink
from .history import BatteryHistory
from .ipc import Channel
from .logger import Logger
from .manager import DeviceManager


async def _run(ipc: bool) -> None:
    logs = Logger("agent")

    # Adaptive polling: every POLL_INTERVAL_ACTIVE s while the app is open here, every
    # POLL_INTERVAL_MIN s while a battery moves (charging, low, changing), POLL_INTERVAL when steady.
    interval = int(environ.get("POLL_INTERVAL", 60))
    history = BatteryHistory(
        path=environ.get("HISTORY_PATH", "data/battery.db"),
        retention_days=int(environ.get("HISTORY_DAYS", 90)),
        # A device that misses a few polls kept its level; one that misses more was away.
        max_gap=max(3 * interval, 120),
    )
    manager = DeviceManager(
        interval=interval,
        logs=logs,
        history=history,
        min_interval=int(environ.get("POLL_INTERVAL_MIN", 30)),
        active_interval=float(environ.get("POLL_INTERVAL_ACTIVE", 1)),
    )

    tasks = [asyncio.create_task(manager.run_forever(), name="poller")]
    logs.info(
        f"Polling devices every {manager.min_interval:g}-{manager.interval:g}s, "
        f"{manager.active_interval:g}s while the app is open"
    )

    # devices.bayfield.dev: send every poll there, so the data follows you from computer to computer
    central_url = environ.get("CENTRAL_URL", "").strip()
    agent_key = environ.get("AGENT_KEY", "").strip()
    if central_url and agent_key:
        link = CentralLink(central_url, agent_key, environ.get("AGENT_NAME", "").strip() or None, manager, history, logs)
        tasks.append(asyncio.create_task(link.report_forever(), name="central_report"))
        logs.info(f"Reporting to {central_url} as '{link.name}'")
    elif central_url or agent_key:
        logs.warning("Set both CENTRAL_URL and AGENT_KEY to report to devices.bayfield.dev")
    else:
        logs.info("Not linked to devices.bayfield.dev: keeping the history on this computer only")

    try:
        if ipc:
            channel = Channel(manager, logs)
            channel.start()
            await channel.closed.wait()  # the desktop app quit
            logs.info("The app closed the channel, stopping")
        else:
            await asyncio.Event().wait()  # until Ctrl+C
    finally:
        for task in tasks:
            task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.gather(*tasks, return_exceptions=True)
        history.close()


def run(ipc: bool = False) -> None:
    load_dotenv(dotenv_path=".env")
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_run(ipc))
