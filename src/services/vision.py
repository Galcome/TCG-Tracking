"""Reading card names off a photo.

**Eyes, not judgement.** The model fills in fields; a person presses save. It never writes to
the ledger, and it is never asked what anything is worth. AI-estimated values or sell
recommendations are confident guessing dressed as advice, on real money, in an app whose
whole discipline is refusing to invent financial data. Unknown stays Unknown.

Three rules shape everything here:

**Unsure comes back blank, never guessed.** A wrong card name mints a phantom product that
then splits every report - the same twin problem as Fable/Fabled, arriving by camera. "Did
not catch this one" is the correct output.

**The risky field is the variant, not the character.** Any model reads "Mickey Mouse"
reliably; telling an Iconic foil from a regular is a tiny set symbol and a treatment, and
that distinction is $560 against about $2. So the prompt asks for set and variant explicitly
and is told to leave them empty rather than guess.

**It degrades to typing.** No key, a failed call, a rate limit, a malformed answer - every
screen still works exactly as it did, the same way the app behaves with no price feed.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

#: Gemini's REST endpoint. The model is the cheapest one that reads images, because this is
#: an accelerator on a form somebody can always fill in by hand.
#:
#: Built per call rather than at import, because the model name is configuration and a
#: pinned one expires. This shipped hardcoded to `gemini-2.0-flash`; Google retired that
#: entire generation, and the live API answers `404 NOT_FOUND - no longer available`. Every
#: photo would have degraded to typing, silently and forever, with the tests all passing -
#: they mock the call, so no suite on earth would have caught it.
_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def _endpoint() -> str:
    return _ENDPOINT.format(model=settings.gemini_model)

#: Deliberately blunt. A retry loop against a free tier is how the free tier stops being
#: free, and nothing here is worth that - the fallback is typing, which always works.
MIN_SECONDS_BETWEEN_CALLS = 3.0

MAX_IMAGE_BYTES = 6 * 1024 * 1024

_PROMPT = """You are reading a photo of trading cards laid out on a surface.

List every distinct card you can see. For each one return:
- name: the character or card name printed on it
- set: the set or expansion, if you can read it
- variant: foil, holo, alternate art, full art, or similar treatment, if visible

Rules you must follow:
- If you are not confident about a field, return an empty string for it. Never guess.
- If you cannot identify a card at all, leave it out entirely.
- Do not estimate value, condition, rarity or price. You are not asked for those.

Return only JSON: {"cards": [{"name": "", "set": "", "variant": ""}]}"""


@dataclass(frozen=True)
class ReadCard:
    """One card the model believes it saw. Empty strings mean it would not say."""

    name: str
    set_name: str
    variant: str


class VisionUnavailable(RuntimeError):
    """No key, rate limited, or the call failed. Callers fall back to typing."""


_last_call_at = 0.0


def is_configured() -> bool:
    """Whether a key exists at all. The UI hides the button when it does not."""
    return bool(settings.gemini_api_key)


def _rate_limit() -> None:
    global _last_call_at
    now = time.monotonic()
    if now - _last_call_at < MIN_SECONDS_BETWEEN_CALLS:
        raise VisionUnavailable("Give it a few seconds between photos.")
    _last_call_at = now


def _parse(payload: dict) -> list[ReadCard]:
    """Pull the card list out of the response, tolerating anything malformed.

    A model that returns prose instead of JSON, or JSON of the wrong shape, produces an
    empty list rather than an exception. The screen it feeds still works; it just has
    nothing to prefill.
    """
    try:
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        return []

    # Models wrap JSON in code fences often enough to be worth handling.
    cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")

    try:
        parsed = json.loads(cleaned)
        rows = parsed["cards"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return []
    if not isinstance(rows, list):
        return []

    cards: list[ReadCard] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        # A card with no name is not a card. Better to drop it than to add a blank row
        # somebody has to notice and delete.
        if not name:
            continue
        cards.append(
            ReadCard(
                name=name,
                set_name=str(row.get("set") or "").strip(),
                variant=str(row.get("variant") or "").strip(),
            )
        )
    return cards


def read_cards(image: bytes, content_type: str) -> list[ReadCard]:
    """What the model thinks it can see. Raises `VisionUnavailable` rather than guessing."""
    if not is_configured():
        raise VisionUnavailable("No vision key is configured.")
    if len(image) > MAX_IMAGE_BYTES:
        raise VisionUnavailable("That photo is too large. Try a smaller one.")

    _rate_limit()

    body = {
        "contents": [
            {
                "parts": [
                    {"text": _PROMPT},
                    {
                        "inline_data": {
                            "mime_type": content_type,
                            "data": base64.b64encode(image).decode(),
                        }
                    },
                ]
            }
        ],
        "generationConfig": {"responseMimeType": "application/json"},
    }

    try:
        response = httpx.post(
            _endpoint(),
            json=body,
            # The key goes in a header rather than the query string, so it cannot end up
            # in anybody's access log.
            headers={"x-goog-api-key": settings.gemini_api_key},
            timeout=30.0,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        # Deliberately not logging the exception body: it can echo the request, and the
        # request carries the key.
        logger.warning("vision call failed: %s", type(error).__name__)
        raise VisionUnavailable("Could not read that photo. Type them in instead.") from error

    return _parse(response.json())
