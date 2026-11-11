from datetime import datetime
from os import environ
from textwrap import dedent

from dotenv import load_dotenv
from sanic import Sanic

from .components.auth import Auth
from .components.blueprint import BlueprintLoader
from .components.cors import DEFAULT_ORIGINS, Cors
from .components.errors import ErrorHandler
from .components.middleware import Middleware
from .components.ratelimit import Ratelimiter
from .config import AppConfig
from .services.central import CentralLink
from .services.history import BatteryHistory
from .services.manager import DeviceManager
from .utils.logger import Logger

load_dotenv(dotenv_path=".env")


# Application initialization
app = Sanic(
    name="WirelessDevicesAPI",
    config=AppConfig(),
)

# The one secret: every route but the documentation requires it
app.config.API_TOKEN = environ.get("API_TOKEN", "").strip()

# Adds information to the OpenAPI documentation
app.ext.openapi.raw(
    {
        "servers": [
            {
                "url": f"{environ.get('API_DOMAIN', 'http://localhost:7000')}",
                "description": "Device host",
            }
        ],
    }
)

year = datetime.now().year

app.ext.openapi.add_security_scheme(
    "token",
    "http",
    scheme="bearer",
)

app.ext.openapi.describe(
    title=app.name,
    version=f"v{app.config.API_VERSION}",
    description=dedent(
        f"""
            # 🎧 • Wireless Devices API
            Control my wireless devices and read their batteries: Bose headphones and speakers over BMAP,
            a Logitech mouse over HID++. Runs on the machine the devices are connected to.
            ⁣
            # 🔑 • Authentication
            **Every route requires the API token**, except this documentation. Send it with the `Authorization` header:
            ```
            Authorization: Bearer <API_TOKEN>
            ```
            `X-API-Key: <API_TOKEN>` is also accepted.
            ⁣
            Requests are rate-limited per client IP.
            ⁣
            # 📩 • Contact
            - E-mail : [paul@bayfield.dev](mailto:paul@bayfield.dev)
            ⁣
            **Paul Bayfield © {year} | All rights reserved.**
        """
    ),
)

# Logger registration
app.ctx.logs = Logger("logs")

# Rate limiter registration
app.ctx.ratelimiter = Ratelimiter()

# Middleware registration
Middleware(app)

# The Devices app (web and desktop) controls this computer's devices from the browser
Cors(app, [o.strip() for o in environ.get("CORS_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",") if o.strip()])

# API token authentication registration
Auth(app)

# Route registration
BlueprintLoader(app).register()

# Error registration
ErrorHandler(app)


@app.listener("before_server_start")
async def setup_app(app: Sanic):
    if len(app.config.API_TOKEN) < 32:
        app.ctx.logs.critical("API_TOKEN is missing or shorter than 32 characters, refusing to start!")
        app.ctx.logs.info('Generate one with: uv run python -c "import secrets; print(secrets.token_urlsafe(32))"')
        exit(1)

    # Adaptive polling: every POLL_INTERVAL_ACTIVE s while the app is open here, every
    # POLL_INTERVAL_MIN s while a battery moves (charging, low, changing), POLL_INTERVAL when steady.
    interval = int(environ.get("POLL_INTERVAL", 60))
    min_interval = int(environ.get("POLL_INTERVAL_MIN", 30))
    active_interval = float(environ.get("POLL_INTERVAL_ACTIVE", 1))

    # A device that misses a couple of polls kept its level; one that misses
    # more was away, and its history shows a hole rather than a flat line.
    app.ctx.history = BatteryHistory(
        path=environ.get("HISTORY_PATH", "data/battery.db"),
        retention_days=int(environ.get("HISTORY_DAYS", 90)),
        max_gap=max(3 * interval, 120),
    )

    app.ctx.devices = DeviceManager(
        interval=interval,
        logs=app.ctx.logs,
        history=app.ctx.history,
        min_interval=min_interval,
        active_interval=active_interval,
    )


@app.listener("after_server_start")
async def start_polling(app: Sanic):
    app.add_task(app.ctx.devices.run_forever(), name="device_poller")
    devices = app.ctx.devices
    app.ctx.logs.info(
        f"API started, polling devices every {devices.min_interval:g}-{devices.interval:g}s, "
        f"{devices.active_interval:g}s while the app is open"
    )

    # devices.bayfield.dev: send every poll there, so the data follows you from computer to computer
    central_url = environ.get("CENTRAL_URL", "").strip()
    agent_key = environ.get("AGENT_KEY", "").strip()
    if central_url and agent_key:
        link = CentralLink(
            url=central_url,
            key=agent_key,
            name=environ.get("AGENT_NAME", "").strip() or None,
            manager=app.ctx.devices,
            history=app.ctx.history,
            logs=app.ctx.logs,
        )
        app.add_task(link.report_forever(), name="central_report")
        app.ctx.logs.info(f"Reporting to {central_url} as '{link.name}'")
    elif central_url or agent_key:
        app.ctx.logs.warning("Set both CENTRAL_URL and AGENT_KEY to report to devices.bayfield.dev")


@app.listener("after_server_stop")
async def close_app(app: Sanic):
    app.ctx.history.close()
    app.ctx.logs.info("API stopped")
