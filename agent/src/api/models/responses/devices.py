from sanic_ext import openapi


class BatteryReading:
    percent = openapi.Integer(
        description="Charge left, 0-100. Null when the device answered without a level",
        example=70,
        nullable=True,
    )
    state = openapi.String(
        description="Charging state: discharging, charging, full, not charging, error, or unknown when the device does not say",
        example="discharging",
    )
    charging = openapi.Boolean(
        description="Whether it is on the charger. Null when the device does not say",
        example=False,
        nullable=True,
    )
    millivolts = openapi.Integer(
        description="Raw cell voltage, for devices that measure it",
        example=3807,
        nullable=True,
    )


class DeviceSummary:
    id = openapi.String(
        description="Stable device id: the model key and where it is",
        example="qc45-acbf718224e0",
    )
    vendor = openapi.String(description="Who made it", example="bose")
    key = openapi.String(description="Model key", example="qc45")
    kind = openapi.String(description="What it is: headphones, speaker, mouse", example="headphones")
    model = openapi.String(description="Model name", example="Bose QuietComfort 45")
    name = openapi.String(description="The name the device or the OS reports", example="Polo's Headphones")
    address = openapi.String(description="Bluetooth address, or receiver and slot", example="AC:BF:71:82:24:E0")
    connected = openapi.Boolean(description="Whether it is reachable right now", example=True)
    #: Last battery reading, kept while the device is away. Null if never read.
    battery = BatteryReading
    battery_updated_at = openapi.DateTime(
        description="When the battery was read (UTC, ISO 8601)",
        example="2026-09-26T15:42:10+00:00",
        nullable=True,
    )
    last_seen_at = openapi.DateTime(
        description="Last time the device answered (UTC, ISO 8601)",
        example="2026-09-26T15:42:10+00:00",
        nullable=True,
    )
    error = openapi.String(
        description="Why the last attempt to reach it failed, null after a success",
        example=None,
        nullable=True,
    )


class DevicesList:
    devices = openapi.Array(DeviceSummary, description="Every device seen since the API started")
    polled_at = openapi.DateTime(
        description="When the last battery poll finished (UTC, ISO 8601)",
        example="2026-09-26T15:42:10+00:00",
        nullable=True,
    )
    poll_interval = openapi.Integer(description="Seconds between two polls", example=60)


class Devices:
    success = openapi.Boolean(description="Request status", example=True)
    data = DevicesList


class Device:
    success = openapi.Boolean(description="Request status", example=True)
    data = DeviceSummary


class HistoryReading:
    """Consecutive polls that returned the same level and charging state."""

    from_ = openapi.DateTime(
        name="from",
        description="First poll at this level and state (UTC, ISO 8601)",
        example="2026-09-26T15:42:10+00:00",
    )
    to = openapi.DateTime(
        description="Last poll at this level and state (UTC, ISO 8601)",
        example="2026-09-26T16:10:40+00:00",
    )
    percent = openapi.Integer(description="Charge left, 0-100", example=70)
    state = openapi.String(
        description="Charging state: discharging, charging, full, not charging, error, or unknown",
        example="discharging",
    )
    millivolts = openapi.Integer(
        description="Raw cell voltage at the last poll, for devices that measure it",
        example=3807,
        nullable=True,
    )
    gap = openapi.Boolean(
        description="Whether the device was away (off, asleep, API stopped) between the previous reading and this one",
        example=False,
    )


class HistoryPhase:
    state = openapi.String(
        description="Charging state throughout the phase: discharging, charging, full, not charging or error",
        example="charging",
    )
    inferred = openapi.Boolean(
        description=(
            "True when the device does not report its charging state and the phase was deduced from a "
            "rising level. Only charging phases are inferred"
        ),
        example=False,
    )
    from_ = openapi.DateTime(
        name="from",
        description="Start of the phase (UTC, ISO 8601)",
        example="2026-09-26T15:42:10+00:00",
    )
    to = openapi.DateTime(description="End of the phase (UTC, ISO 8601)", example="2026-09-26T17:20:10+00:00")
    from_percent = openapi.Integer(description="Level at the start of the phase", example=23)
    to_percent = openapi.Integer(description="Level at the end of the phase", example=100)


class HistoryData:
    since = openapi.DateTime(description="Start of the window (UTC, ISO 8601)", example="2026-09-25T17:20:10+00:00")
    until = openapi.DateTime(description="End of the window (UTC, ISO 8601)", example="2026-09-26T17:20:10+00:00")
    retention_days = openapi.Integer(description="How many days of history are kept", example=90)
    readings = openapi.Array(HistoryReading, description="The battery level over the window, oldest first")
    phases = openapi.Array(HistoryPhase, description="The charging phases over the window, oldest first")


class History:
    success = openapi.Boolean(description="Request status", example=True)
    data = HistoryData


class Settings:
    success = openapi.Boolean(description="Request status", example=True)
    data = openapi.Object(
        description=(
            "Every setting the model has, read live from the device, with the ranges needed to draw it. "
            "Only what the model supports is present: `volume`, `eq`, `cnc`, `mode`... on Bose; "
            "`dpi`, `report_rate`, `onboard_mode`, `led` on Logitech. `actions` lists what "
            "`POST /v1/devices/<id>/actions/<action>` accepts."
        ),
        example={
            "name": "Polo's Headphones",
            "volume": {"level": 4, "max": 32, "safe_max": 15},
            "eq": [{"band": "bass", "value": 2, "min": -10, "max": 10}],
            "cnc": {"level": 0, "max": 10},
            "actions": ["play", "pause", "next", "prev", "power_off", "pairing"],
        },
    )


class SettingsChanges:
    """The body of ``PATCH /v1/devices/<id>/settings``: only the fields to change."""

    body = openapi.Object(
        description="Only the fields to change. See the route description for what each vendor accepts.",
        example={"volume": 8, "eq": {"bass": 3}, "cnc": 0},
    )


class ActionParams:
    """The optional body of ``POST /v1/devices/<id>/actions/<action>``."""

    body = openapi.Object(
        description="Parameters for the action; only `pairing` takes one.",
        example={"enabled": False},
    )


class Message:
    success = openapi.Boolean(description="Request status", example=True)
    message = openapi.String(description="Response message", example="Done.")
