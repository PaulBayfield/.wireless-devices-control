from sanic_ext import openapi


class Unauthorized:
    success = openapi.Boolean(
        description="Request status",
        example=False,
    )
    message = openapi.String(
        description="Error message",
        example="Missing or invalid API token.",
    )
