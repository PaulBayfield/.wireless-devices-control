from sanic import Blueprint, Request
from sanic.response import JSONResponse
from sanic_ext import openapi

from ....components.ratelimit import ratelimit
from ....components.response import JSON
from ....exceptions.devices import InvalidInput
from ....models.exceptions import (
    BadRequest,
    NotConnected,
    NotFound,
    RateLimited,
    Unauthorized,
    Unreachable,
)
from ....models.responses import (
    ActionParams,
    Device,
    Devices,
    Message,
    Settings,
    SettingsChanges,
)
from ....services import controls
from ....services.manager import DeviceManager

bp = Blueprint(
    name="Devices",
    url_prefix="/",
    version=1,
    version_prefix="v",
)


_UNAUTHORIZED_RESPONSE = openapi.response(
    status=401,
    content={"application/json": Unauthorized},
    description="Missing or invalid API token.",
)
_RATELIMITED_RESPONSE = openapi.response(
    status=429,
    content={"application/json": RateLimited},
    description="You have sent too many requests. Please try again later.",
)
_NOT_FOUND_RESPONSE = openapi.response(
    status=404,
    content={"application/json": NotFound},
    description="No device with that id has been discovered.",
)
_NOT_CONNECTED_RESPONSE = openapi.response(
    status=409,
    content={"application/json": NotConnected},
    description="The device is known but not reachable right now: off, asleep, or connected elsewhere.",
)
_UNREACHABLE_RESPONSE = openapi.response(
    status=502,
    content={"application/json": Unreachable},
    description="The device did not answer, or refused the request.",
)
_BAD_REQUEST_RESPONSE = openapi.response(
    status=400,
    content={"application/json": BadRequest},
    description="The body is not valid JSON, or asks for something the device does not have or accept.",
)
_ID_PARAMETER = openapi.parameter(
    name="device_id",
    description="Device id, as returned by `GET /v1/devices`",
    schema=str,
    location="path",
    required=True,
    example="qc45-acbf718224e0",
)


def _manager(request: Request) -> DeviceManager:
    return request.app.ctx.devices


def _devices_payload(request: Request) -> dict:
    manager = _manager(request)
    return {
        "devices": [state.to_dict() for state in manager.all()],
        "polled_at": manager.polled_at.isoformat(timespec="seconds") if manager.polled_at else None,
        "poll_interval": manager.interval,
    }


def _body(request: Request) -> dict:
    """The JSON body as an object, or a 400."""
    try:
        body = request.json
    except Exception as e:
        raise InvalidInput("The body must be valid JSON.") from e
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise InvalidInput("The body must be a JSON object.")
    return body


# /devices
@bp.route("/devices", methods=["GET"])
@openapi.definition(
    summary="List devices",
    description=(
        "Every device seen since the API started, with its last battery reading. Answered from memory: "
        "batteries are polled in the background every `poll_interval` seconds, so this is instant. "
        "A device that goes away keeps its last reading, with `connected: false`."
    ),
    tag="Devices",
    secured={"token": []},
)
@openapi.response(
    status=200,
    content={"application/json": Devices},
    description="Every known device.",
)
@_UNAUTHORIZED_RESPONSE
@_RATELIMITED_RESPONSE
@ratelimit()
async def getDevices(request: Request) -> JSONResponse:
    """
    Returns every known device and its last battery reading.

    :return: JSONResponse
    """
    return JSON(
        request=request,
        success=True,
        data=_devices_payload(request),
        status=200,
    ).generate()


# /devices/refresh
@bp.route("/devices/refresh", methods=["POST"])
@openapi.definition(
    summary="Poll now",
    description=(
        "Rediscovers every device and reads every connected battery right away, instead of waiting for the "
        "next background poll, then returns the same list as `GET /v1/devices`. Takes a few seconds."
    ),
    tag="Devices",
    secured={"token": []},
)
@openapi.response(
    status=200,
    content={"application/json": Devices},
    description="Every known device, freshly polled.",
)
@_UNAUTHORIZED_RESPONSE
@_RATELIMITED_RESPONSE
@ratelimit()
async def refreshDevices(request: Request) -> JSONResponse:
    """
    Polls every device now.

    :return: JSONResponse
    """
    await _manager(request).refresh()

    return JSON(
        request=request,
        success=True,
        data=_devices_payload(request),
        status=200,
    ).generate()


# /devices/<device_id>
@bp.route("/devices/<device_id:str>", methods=["GET"])
@openapi.definition(
    summary="Get a device",
    description="One device and its last battery reading, from memory.",
    tag="Devices",
    secured={"token": []},
)
@_ID_PARAMETER
@openapi.response(
    status=200,
    content={"application/json": Device},
    description="The device.",
)
@_UNAUTHORIZED_RESPONSE
@_NOT_FOUND_RESPONSE
@_RATELIMITED_RESPONSE
@ratelimit()
async def getDevice(request: Request, device_id: str) -> JSONResponse:
    """
    Returns one device.

    :return: JSONResponse
    """
    return JSON(
        request=request,
        success=True,
        data=_manager(request).get(device_id).to_dict(),
        status=200,
    ).generate()


# /devices/<device_id>/settings
@bp.route("/devices/<device_id:str>/settings", methods=["GET"])
@openapi.definition(
    summary="Read the settings",
    description=(
        "Every setting the model has, read live from the device, with the ranges needed to draw a control "
        "for it. Only what the model supports is present."
    ),
    tag="Devices",
    secured={"token": []},
)
@_ID_PARAMETER
@openapi.response(
    status=200,
    content={"application/json": Settings},
    description="The device's current settings.",
)
@_UNAUTHORIZED_RESPONSE
@_NOT_FOUND_RESPONSE
@_NOT_CONNECTED_RESPONSE
@_RATELIMITED_RESPONSE
@_UNREACHABLE_RESPONSE
@ratelimit()
async def getSettings(request: Request, device_id: str) -> JSONResponse:
    """
    Reads a device's settings.

    :return: JSONResponse
    """
    manager = _manager(request)
    vendor = controls.for_vendor(manager.get(device_id).found.vendor)

    return JSON(
        request=request,
        success=True,
        data=await manager.run(device_id, vendor.read),
        status=200,
    ).generate()


# /devices/<device_id>/settings
@bp.route("/devices/<device_id:str>/settings", methods=["PATCH"])
@openapi.definition(
    summary="Change settings",
    description=(
        "Changes some settings, then returns them all, read back from the device. Send only the fields to "
        "change; a field the model does not have is refused rather than ignored.\n\n"
        "**Bose:** `name`, `volume` (stops at `safe_max` unless `loud: true`), `eq` "
        "(`{\"bass\", \"mid\", \"treble\"}`, each -10..10, partial allowed), `standby_minutes`, `multipoint`, "
        "`prompts`, `sidetone` (off, low, medium, high), and on the QC45 `mode` (slot or name), `cnc` "
        "(0 = max ANC .. 10) and `wind_block`.\n\n"
        "**Logitech:** `dpi`, `report_rate`, `onboard_mode` (host, onboard), `led` "
        "(`{\"zone\", \"effect\", \"color\": \"RRGGBB\", \"period\", \"brightness\"}`)."
    ),
    tag="Devices",
    secured={"token": []},
    body={"application/json": SettingsChanges.body},
)
@_ID_PARAMETER
@openapi.response(
    status=200,
    content={"application/json": Settings},
    description="The settings after the change.",
)
@_BAD_REQUEST_RESPONSE
@_UNAUTHORIZED_RESPONSE
@_NOT_FOUND_RESPONSE
@_NOT_CONNECTED_RESPONSE
@_RATELIMITED_RESPONSE
@_UNREACHABLE_RESPONSE
@ratelimit()
async def updateSettings(request: Request, device_id: str) -> JSONResponse:
    """
    Changes a device's settings.

    :return: JSONResponse
    """
    changes = _body(request)
    if not changes:
        raise InvalidInput("Send at least one setting to change.")

    manager = _manager(request)
    vendor = controls.for_vendor(manager.get(device_id).found.vendor)

    def apply_then_read(dev):
        vendor.apply(dev, changes)
        return vendor.read(dev)

    try:
        settings = await manager.run(device_id, apply_then_read)
    except ValueError as e:
        raise InvalidInput(str(e)) from e

    return JSON(
        request=request,
        success=True,
        data=settings,
        status=200,
    ).generate()


# /devices/<device_id>/actions/<action>
@bp.route("/devices/<device_id:str>/actions/<action:str>", methods=["POST"])
@openapi.definition(
    summary="Run an action",
    description=(
        "A one-shot action, from the `actions` list of `GET /v1/devices/<id>/settings`: transport controls "
        "(`play`, `pause`, `stop`, `next`, `prev`), `power_off`, and `pairing` "
        "(body `{\"enabled\": false}` to leave pairing mode)."
    ),
    tag="Devices",
    secured={"token": []},
    body={"application/json": ActionParams.body},
)
@_ID_PARAMETER
@openapi.parameter(
    name="action",
    description="The action to run",
    schema=str,
    location="path",
    required=True,
    example="pause",
)
@openapi.response(
    status=200,
    content={"application/json": Message},
    description="The device accepted the action.",
)
@_BAD_REQUEST_RESPONSE
@_UNAUTHORIZED_RESPONSE
@_NOT_FOUND_RESPONSE
@_NOT_CONNECTED_RESPONSE
@_RATELIMITED_RESPONSE
@_UNREACHABLE_RESPONSE
@ratelimit()
async def runAction(request: Request, device_id: str, action: str) -> JSONResponse:
    """
    Runs an action on a device.

    :return: JSONResponse
    """
    params = _body(request)
    manager = _manager(request)
    vendor = controls.for_vendor(manager.get(device_id).found.vendor)

    try:
        await manager.run(device_id, lambda dev: vendor.act(dev, action, params))
    except ValueError as e:
        raise InvalidInput(str(e)) from e

    return JSON(
        request=request,
        success=True,
        message=f"'{action}' sent.",
        status=200,
    ).generate()
