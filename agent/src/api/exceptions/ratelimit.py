from sanic.exceptions import SanicException


class RatelimitException(SanicException):
    status_code = 429
    quiet = True

    @property
    def message(self):
        return f"You have sent too many requests. Please try again in {self.extra['cooldown']} seconds."
