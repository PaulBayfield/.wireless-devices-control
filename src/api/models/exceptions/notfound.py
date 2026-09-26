from sanic_ext import openapi


class NotFound:
    success = openapi.Boolean(
        description="Request status",
        example=False,
    )
    message = openapi.String(
        description="Error message",
        example="No device with id 'qc45-acbf718224e0'.",
    )
