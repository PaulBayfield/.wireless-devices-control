from sanic.request import Request
from sanic.response import JSONResponse, json


class Response:
    """
    Base class for responses
    """

    def __init__(self, request: Request) -> None:
        """
        :param request: Request
        """
        self.request = request

    def generate(self) -> None:
        """
        Generates the response
        """
        raise NotImplementedError


class JSON(Response):
    """
    JSON responses
    """

    def __init__(
        self,
        request: Request,
        success: bool = True,
        data: dict | list | None = None,
        status: int = 200,
        message: str | None = None,
    ) -> None:
        """
        :param request: Request
        :param success: bool
        :param data: dict | list
        :param status: int
        :param message: str
        """
        super().__init__(request)
        self.data = data
        self.success = success
        self.status = status
        self.message = message

    def generate(self) -> JSONResponse:
        """
        Generates the response

        :return: JSONResponse
        """
        if self.data is None and not self.message:
            return json(
                {
                    "success": self.success,
                    "message": "Something went wrong... Please try again later.",
                },
                status=self.status,
            )

        if self.message:
            return json(
                {"success": self.success, "message": self.message}, status=self.status
            )

        return json({"success": self.success, "data": self.data}, status=self.status)
