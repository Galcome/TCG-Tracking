"""URL-safe slugs for user-created games and product types."""

import re
import unicodedata

_NON_SLUG_CHARS = re.compile(r"[^a-z0-9]+")

SLUG_MAX_LENGTH = 60


def slugify(value: str) -> str:
    """Reduce a display name to a lowercase ASCII slug.

    "Pokémon" -> "pokemon", "Magic: The Gathering" -> "magic-the-gathering".
    Returns "" when nothing usable survives, which callers must reject.
    """
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    hyphenated = _NON_SLUG_CHARS.sub("-", ascii_only.lower())
    return hyphenated.strip("-")[:SLUG_MAX_LENGTH].strip("-")
