from sanic_ext import openapi


class Unreachable:
    success = openapi.Boolean(
        description="Request status",
        example=False,
    )
    message = openapi.String(
        description="Error message",
        example="Polo's Headphones: Timed out waiting for a reply.",
    )
