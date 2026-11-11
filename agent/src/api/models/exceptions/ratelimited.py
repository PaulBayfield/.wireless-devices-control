from sanic_ext import openapi


class RateLimited:
    success = openapi.Boolean(
        description="Request status",
        example=False,
    )
    message = openapi.String(
        description="Error message",
        example="You have sent too many requests. Please try again in 30 seconds.",
    )
