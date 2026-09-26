import importlib
from pathlib import Path

ROUTES = Path(__file__).resolve().parent.parent / "routes"


class BlueprintLoader:
    """
    Loads the blueprints of the different API versions
    """

    def __init__(self, app):
        """
        :param app: Sanic
        """
        self.app = app

    def register(self) -> None:
        """
        Registers the routes of the different API versions
        """
        logs = self.app.ctx.logs
        logs.info("Registering routes...")

        for version in sorted(p.name for p in ROUTES.iterdir() if p.is_dir()):
            if version.startswith("v"):
                logs.info(f"Loading routes for version {version}")

                blueprint = importlib.import_module(f"src.api.routes.{version}")

                if not hasattr(blueprint, "__routes__") or len(blueprint.__routes__) == 0:
                    logs.warning(f"Blueprint {version} ({blueprint.__version__}) has no routes defined! Skipped...")
                    continue

                logs.info(
                    f"Blueprint {version} ({blueprint.__version__}) has {len(blueprint.__routes__)} routes: "
                    f"{', '.join([route.name for route in blueprint.__routes__])}"
                )

                for route in blueprint.__routes__:
                    self.app.blueprint(route)
