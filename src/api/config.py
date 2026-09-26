from pathlib import Path

from sanic.config import Config


class AppConfig(Config):
    API_VERSION = "1.0.0"
    API_CONTACT_EMAIL = "paul@bayfield.dev"

    OAS = True
    OAS_UI_DEFAULT = "scalar"
    OAS_UI_SCALAR = True
    OAS_PATH_TO_SCALAR_HTML = str(Path(__file__).with_name("scalar.html"))
    OAS_UI_REDOC = False
    OAS_UI_SWAGGER = False
    OAS_URI_TO_JSON = "/openapi.json"
    OAS_URL_PREFIX = "/"

    FALLBACK_ERROR_FORMAT = "json"

    # Paths reachable without the API token (documentation only)
    PUBLIC_PATHS = ("/", "/openapi.json")
