from datetime import datetime
from os import environ
from textwrap import dedent

from dotenv import load_dotenv
from sanic import Sanic

from .components.auth import Auth
from .components.blueprint import BlueprintLoader
from .components.errors import ErrorHandler
from .components.middleware import Middleware
from .components.ratelimit import Ratelimiter
from .config import AppConfig
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

    app.ctx.devices = DeviceManager(
        interval=int(environ.get("POLL_INTERVAL", 30)),
        logs=app.ctx.logs,
    )


@app.listener("after_server_start")
async def start_polling(app: Sanic):
    app.add_task(app.ctx.devices.run_forever(), name="device_poller")
    app.ctx.logs.info(f"API started, polling devices every {app.ctx.devices.interval:g}s")


@app.listener("after_server_stop")
async def close_app(app: Sanic):
    app.ctx.logs.info("API stopped")
