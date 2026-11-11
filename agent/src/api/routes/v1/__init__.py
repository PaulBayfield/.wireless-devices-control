from .devices.v1_devices import bp as RouteDevices
from .service.v1_service import bp as RouteService

# Version metadata
__version__ = "1.0.0"
__author__ = "Paul Bayfield"
__description__ = "/v1 of the wireless devices API"
__routes__ = [
    RouteDevices,
    RouteService,
]


__all__ = [
    "__version__",
    "__author__",
    "__description__",
    "__routes__",
]
