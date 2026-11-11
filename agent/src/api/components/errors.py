from sanic import Request, Sanic
from sanic.exceptions import NotFound, SanicException
from sanic.response import JSONResponse

from ..exceptions.devices import (
    DeviceNotConnected,
    DeviceNotFound,
    DeviceUnreachable,
    InvalidInput,
)
from ..exceptions.ratelimit import RatelimitException
from .ratelimit import ratelimit
from .response import JSON


class ErrorHandler:
    """
    Handles errors
    """

    def __init__(self, app: Sanic) -> None:
        """
        :param app: Sanic
        """
        self.app = app

        @app.exception(NotFound)
        @ratelimit()
        async def handle_not_found(request: Request, exception: NotFound) -> JSONResponse:
            return JSON(
                request=request,
                success=False,
                message="The requested resource does not exist.",
                status=exception.status_code,
            ).generate()

        @app.exception(RatelimitException)
        async def handle_ratelimit(request: Request, exception: RatelimitException) -> JSONResponse:
            response = JSON(
                request=request,
                success=False,
                message=exception.message,
                status=exception.status_code,
            ).generate()
            response.headers.update(exception.headers or {})

            return response

        @app.exception(DeviceNotFound, DeviceNotConnected, InvalidInput, DeviceUnreachable)
        async def handle_device_error(request: Request, exception: SanicException) -> JSONResponse:
            if isinstance(exception, DeviceUnreachable):
                self.app.ctx.logs.warning(f"{request.method} {request.path}: {exception.message}")

            return JSON(
                request=request,
                success=False,
                message=exception.message,
                status=exception.status_code,
            ).generate()

        @app.exception(Exception, SanicException)
        async def handle_exception(request: Request, exception: Exception) -> JSONResponse:
            self.app.ctx.logs.error(f"Error: {exception}")

            return JSON(
                request=request,
                success=False,
                message="An error occurred while processing your request.",
                status=getattr(exception, "status_code", 500),
            ).generate()
