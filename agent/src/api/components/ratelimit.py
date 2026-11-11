import binascii
import functools
import time

from sanic.request import Request
from sanic.response import HTTPResponse

from ..exceptions.ratelimit import RatelimitException


class Bucket:
    """
    Rate limiting bucket

    :param ident: Bucket identifier
    :param limit: Number of allowed requests
    :param secs: Bucket duration in seconds
    """

    def __init__(self, ident: str, limit: int, secs: int) -> None:
        self.ident = binascii.crc32(ident.encode())
        self.limit = limit
        self.secs = secs


class Ratelimiter:
    """
    Handles rate limits
    """

    def __init__(self) -> None:
        """
        Initialization
        """
        self.ratelimits = {}
        self.last_ratelimit_cleanup = int(time.time())

        self.DEFAULT = Bucket("default", 120, 60)
        self.FAILED_AUTH = Bucket("failed_auth", 10, 60)

    async def check_ratelimit(self, key: str, bucket: Bucket) -> dict:
        """
        Checks whether a request is allowed

        :param key: Identifier of the requester
        :param bucket: Rate limiting bucket
        :return: Rate limit headers
        """
        await self.cleanup()

        current_time = int(time.time())
        self.ratelimits.setdefault(key, {})

        window_start = current_time // bucket.secs * bucket.secs

        self.ratelimits[key].setdefault(
            bucket.ident,
            {
                "remaining": bucket.limit,
                "reset": window_start + bucket.secs,
                "window_start": window_start,
            },
        )

        bucket_data = self.ratelimits[key][bucket.ident]

        if current_time >= bucket_data["reset"]:
            bucket_data["remaining"] = bucket.limit
            bucket_data["reset"] = window_start + bucket.secs
            bucket_data["window_start"] = window_start

        bucket_data["remaining"] -= 1

        headers = {
            "X-RateLimit-Limit": bucket.limit,
            "X-RateLimit-Remaining": max(bucket_data["remaining"], 0),
            "X-RateLimit-Reset": bucket_data["reset"] - current_time,
            "X-RateLimit-Bucket": bucket.ident,
            "X-RateLimit-Used": bucket.limit - bucket_data["remaining"],
        }

        if bucket_data["remaining"] < 0:
            headers.update({"Retry-After": bucket_data["reset"] - current_time})
            raise RatelimitException(
                headers=headers,
                extra={"cooldown": bucket_data["reset"] - current_time},
            )

        return headers

    async def cleanup(self) -> None:
        """
        Removes expired rate limits to free memory
        """
        current_time = int(time.time())

        if current_time - self.last_ratelimit_cleanup < 60:
            return

        for key in list(self.ratelimits):
            for bucket, data in list(self.ratelimits[key].items()):
                if data["reset"] < current_time:
                    del self.ratelimits[key][bucket]

            if not self.ratelimits[key]:
                del self.ratelimits[key]

        self.last_ratelimit_cleanup = current_time


def get_client_ip(request: Request) -> str:
    """
    Returns the client IP. The API sits on a LAN or a VPN rather than behind
    Cloudflare, so a forwarding header would only be a way to dodge the
    failed-auth throttle: the socket's address is used as is.

    :param request: Request
    :return: IP address
    """
    return request.client_ip


def ratelimit():
    """
    Decorator limiting the number of requests per client IP
    """

    def wrapper(func) -> callable:
        """
        :param func: Function to decorate
        :return: Decorated function
        """

        @functools.wraps(func)
        async def wrapped(request: Request, *args, **kwargs) -> HTTPResponse:
            """
            :param request: Request
            :return: Response
            """
            ratelimiter: Ratelimiter = request.app.ctx.ratelimiter
            headers = await ratelimiter.check_ratelimit(
                f"ip:{get_client_ip(request)}", ratelimiter.DEFAULT
            )

            resp: HTTPResponse = await func(request, *args, **kwargs)
            resp.headers.update(headers)

            return resp

        return wrapped

    return wrapper
