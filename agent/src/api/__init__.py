"""The HTTP API: the device layer over Sanic, for the web frontend.

Laid out like my other APIs: ``components/`` for auth, rate limiting,
middleware and errors; ``routes/v<n>/<name>/`` for the blueprints;
``models/`` for the OpenAPI schemas; Scalar documentation at ``/``.

It runs on the machine the devices are connected to, as a single process:
:class:`~src.api.services.manager.DeviceManager` owns the hardware, and a
second worker would fight it for the Bluetooth radio and the receiver.
"""

from os import environ

from dotenv import load_dotenv


def serve() -> None:
    """Start the API, configured from the environment (and ``.env``)."""
    load_dotenv(dotenv_path=".env")

    from .app import app

    app.run(
        host=environ.get("API_HOST", "127.0.0.1"),
        port=int(environ.get("API_PORT", 7000)),
        debug=environ.get("API_DEBUG") == "True",
        single_process=True,
        access_log=environ.get("API_DEBUG") == "True",
    )
