"""The Phone Link phone, for the API: read-only, so only what it is."""


def read(dev) -> dict:
    return {"name": dev.name(), "info": {"model": dev.model()}, "actions": []}


def apply(dev, changes: dict) -> None:
    raise ValueError("The phone is read-only here: it has no settings to change.")


def act(dev, action: str, params: dict) -> None:
    raise ValueError(f"Unknown action '{action}'. The phone has none.")
