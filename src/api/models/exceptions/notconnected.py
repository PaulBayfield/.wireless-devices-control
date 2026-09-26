from sanic_ext import openapi


class NotConnected:
    success = openapi.Boolean(
        description="Request status",
        example=False,
    )
    message = openapi.String(
        description="Error message",
        example="Polo's Speakers is not connected.",
    )
