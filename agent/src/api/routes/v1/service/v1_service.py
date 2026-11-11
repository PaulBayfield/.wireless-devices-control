from sanic import Blueprint, Request
from sanic.response import JSONResponse
from sanic_ext import openapi

from ....components.ratelimit import ratelimit
from ....components.response import JSON
from ....models.exceptions import RateLimited, Unauthorized
from ....models.responses import Status

bp = Blueprint(
    name="Service",
    url_prefix="/",
    version=1,
    version_prefix="v",
)


# /status
@bp.route("/status", methods=["GET"])
@openapi.definition(
    summary="API status",
    description="Returns the status of the API.",
    tag="Service",
    secured={"token": []},
)
@openapi.response(
    status=200,
    content={"application/json": Status},
    description="The API is online.",
)
@openapi.response(
    status=401,
    content={"application/json": Unauthorized},
    description="Missing or invalid API token.",
)
@openapi.response(
    status=429,
    content={"application/json": RateLimited},
    description="You have sent too many requests. Please try again later.",
)
@ratelimit()
async def getStatus(request: Request) -> JSONResponse:
    """
    Returns the status of the API.

    :return: JSONResponse
    """
    return JSON(
        request=request,
        success=True,
        message="The API is online.",
        status=200,
    ).generate()
