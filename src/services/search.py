"""Shared search helpers."""


def escape_like(value: str) -> str:
    """Neutralise LIKE wildcards so a user typing '%' searches for a literal '%'.

    Used with `.ilike(pattern, escape="\\\\")`.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
