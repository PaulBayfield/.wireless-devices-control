import hmac

from sanic import Request, Sanic

from .ratelimit import get_client_ip
from .response import JSON


def extract_key(request: Request) -> str:
    """
    Extracts the API token from the request. Supported, in order:
    `Authorization: Bearer <token>` and `X-API-Key: <token>`. There is no
    query parameter: a token in a URL ends up in logs and browser history.

    :param request: Request
    :return: The raw token, or an empty string
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()

    return (request.headers.get("X-API-Key") or "").strip()


class Auth:
    """
    API token authentication. Every route requires the token unless its
    path is listed in `PUBLIC_PATHS` (the documentation).

    There is a single token, `API_TOKEN` in the environment, compared in
    constant time.
    """

    def __init__(self, app: Sanic) -> None:
        """
        :param app: Sanic
        """

        @app.on_request(priority=100)
        async def authenticate(request: Request):
            """
            Rejects requests without the API token

            :param request: Request
            """
            if request.method == "GET" and (request.path.rstrip("/") or "/") in app.config.PUBLIC_PATHS:
                return None

            key = extract_key(request)
            token = app.config.API_TOKEN

            if not key or not hmac.compare_digest(key.encode(), token.encode()):
                # Throttle failed attempts per IP to slow down token guessing
                await app.ctx.ratelimiter.check_ratelimit(
                    f"auth:{get_client_ip(request)}", app.ctx.ratelimiter.FAILED_AUTH
                )

                return JSON(
                    request=request,
                    success=False,
                    message="Missing or invalid API token.",
                    status=401,
                ).generate()
