"""Strict checks for values that came in as JSON.

Each raises ``ValueError`` naming the field, which the routes turn into a
400. ``bool`` is rejected where an int is expected: JSON ``true`` is not a
volume.
"""


def integer(value, field: str, lo: int | None = None, hi: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"'{field}' must be an integer.")
    if lo is not None and value < lo or hi is not None and value > hi:
        raise ValueError(f"'{field}' must be between {lo} and {hi}, got {value}.")
    return value


def boolean(value, field: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"'{field}' must be true or false.")
    return value


def text(value, field: str, max_length: int = 64) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"'{field}' must be a non-empty string.")
    if len(value) > max_length:
        raise ValueError(f"'{field}' must be at most {max_length} characters.")
    return value.strip()


def choice(value, field: str, choices) -> str:
    if value not in choices:
        raise ValueError(f"'{field}' must be one of: {', '.join(map(str, choices))}.")
    return value


def mapping(value, field: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"'{field}' must be an object.")
    return value


def no_unknown(changes: dict, known) -> None:
    """Reject fields this device does not have, rather than ignoring them."""
    unknown = sorted(set(changes) - set(known))
    if unknown:
        raise ValueError(
            f"Unknown or unsupported setting(s) for this device: {', '.join(unknown)}. "
            f"Accepted: {', '.join(sorted(known)) or 'none'}."
        )
