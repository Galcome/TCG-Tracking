"""Reading card names off a photo.

**Eyes, not judgement.** The model fills in fields; a person presses save. It never writes to
the ledger, and it is never asked what anything is worth. AI-estimated values or sell
recommendations are confident guessing dressed as advice, on real money, in an app whose
whole discipline is refusing to invent financial data. Unknown stays Unknown.

Three rules shape everything here:

**Unsure comes back blank, never guessed.** A wrong card name mints a phantom product that
then splits every report - the same twin problem as Fable/Fabled, arriving by camera. "Did
not catch this one" is the correct output.

**The risky fields are the set details, not the character.** Any model reads "Mickey Mouse"
reliably; telling an Iconic foil from a regular is a tiny set symbol and a treatment, and
that distinction is $560 against about $2. So the prompt asks for set, collector number,
variant and language explicitly and is told to leave them empty rather than guess.

**It degrades to typing.** No key, a failed call, a rate limit, a malformed answer - every
screen still works exactly as it did, the same way the app behaves with no price feed.
Before that, a failed or garbled answer moves on to the next provider in `ai.PROVIDERS`
(Gemini, Groq, Haiku, OpenAI), so one provider's outage is not the feature's.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

from src.services import ai

#: Deliberately blunt. A retry loop against a free tier is how the free tier stops being
#: free, and nothing here is worth that - the fallback is typing, which always works.
MIN_SECONDS_BETWEEN_CALLS = 3.0

MAX_IMAGE_BYTES = 6 * 1024 * 1024

_PROMPT = """You are reading a photo of trading cards laid out on a surface.

List every distinct card you can see. For each one return:
- name: the character or card name printed on it
- set: the set or expansion, if you can read it
- collector_number: the printed collector/card number, if visible
- variant: foil, holo, alternate art, full art, or similar treatment, if visible
- language: the card's language, only if it is clear from the card

Rules you must follow:
- If you are not confident about a field, return an empty string for it. Never guess.
- If you cannot identify a card at all, leave it out entirely.
- Do not estimate value, condition, rarity or price. You are not asked for those.

Return only JSON with this shape:
{"cards": [{"name": "", "set": "", "collector_number": "", "variant": "", "language": ""}]}"""


@dataclass(frozen=True)
class ReadCard:
    """One card the model believes it saw. Empty strings mean it would not say."""

    name: str
    set_name: str
    collector_number: str
    variant: str
    language: str


class VisionUnavailable(RuntimeError):
    """No key, rate limited, or the call failed. Callers fall back to typing."""


_last_call_at = 0.0


def is_configured() -> bool:
    """Whether a key exists at all. The UI hides the button when it does not."""
    return ai.is_configured()


def _rate_limit() -> None:
    global _last_call_at
    now = time.monotonic()
    if now - _last_call_at < MIN_SECONDS_BETWEEN_CALLS:
        raise VisionUnavailable("Give it a few seconds between photos.")
    _last_call_at = now


def _parse(text: str) -> list[ReadCard] | None:
    """The card list out of the model's text, or None when it is not the promised shape.

    None moves on to the next provider. An empty list is a real answer - no card it could
    name - and is returned as is rather than paying three more providers to agree.
    """
    try:
        rows = json.loads(ai.clean_json(text))["cards"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    if not isinstance(rows, list):
        return None

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
                collector_number=str(
                    row.get("collector_number") or row.get("collectorNumber") or ""
                ).strip(),
                variant=str(row.get("variant") or "").strip(),
                language=str(row.get("language") or "").strip(),
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

    try:
        cards = ai.ask(_PROMPT, _parse, image=ai.Image(image, content_type))
    except ai.AIUnavailable as error:
        raise VisionUnavailable("Could not read that photo. Type them in instead.") from error
    # Every provider answered with something unreadable: nothing to prefill, same as typing.
    return cards or []
