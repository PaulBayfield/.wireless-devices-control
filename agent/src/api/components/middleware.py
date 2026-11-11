import time
from uuid import uuid1

from sanic import Request, Sanic


class Middleware:
    """
    Request/response middlewares
    """

    def __init__(self, app: Sanic) -> None:
        """
        :param app: Sanic
        """

        @app.on_request(priority=999)
        async def before_request(request: Request):
            """
            Tags incoming requests

            :param request: Request
            """
            request.ctx.request_id = str(uuid1())
            request.ctx.process_time_start = time.perf_counter()

        @app.on_response(priority=999)
        async def after_request(request: Request, response):
            """
            Adds timing and identification headers to responses

            :param request: Request
            :param response: Response
            """
            process_time_end = time.perf_counter()

            # The start time may be missing if the request failed before reaching the request middleware
            if hasattr(request.ctx, "process_time_start"):
                request.ctx.process_time = int((process_time_end - request.ctx.process_time_start) * 1000)
            else:
                app.ctx.logs.warning(
                    f"Processing time is not defined for request {getattr(request.ctx, 'request_id', '?')} ({request.method} {request.path})"
                )
                request.ctx.process_time = -999

            response.headers["X-Request-ID"] = getattr(request.ctx, "request_id", "")
            response.headers["X-Processing-Time"] = f"{request.ctx.process_time}ms"
            response.headers["X-API"] = "WirelessDevicesAPI"
            response.headers["X-API-Version"] = f"v{app.config.API_VERSION}"
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
