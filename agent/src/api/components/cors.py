from sanic import Request, Sanic
from sanic.response import empty

#: Where the Devices app runs: the web app, the desktop app's webview, Vite in development.
DEFAULT_ORIGINS = (
    "https://devices.bayfield.dev",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:1470",
)


class Cors:
    """
    Lets the Devices app (web or desktop) call this API from the browser, to control the
    devices of this computer. The token is still required: CORS only lets the page read the
    answers. Preflights also allow private network access, which Chrome asks for before a
    public page may reach localhost.
    """

    def __init__(self, app: Sanic, origins: list[str]) -> None:
        """
        :param app: Sanic
        :param origins: allowed origins
        """
        allowed = set(origins)
        app.config.CORS = False  # handled here, not by sanic-ext

        def headers(origin: str) -> dict:
            return {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
                "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            }

        @app.on_request(priority=200)
        async def preflight(request: Request):
            """
            Answers preflights before authentication: they never carry the token

            :param request: Request
            """
            origin = request.headers.get("Origin", "")
            if request.method == "OPTIONS" and origin in allowed:
                return empty(status=204, headers={**headers(origin), "Access-Control-Allow-Private-Network": "true"})
            return None

        @app.on_response(priority=200)
        async def allow(request: Request, response):
            """
            :param request: Request
            :param response: Response
            """
            origin = request.headers.get("Origin", "")
            if origin in allowed:
                response.headers.update(headers(origin))
