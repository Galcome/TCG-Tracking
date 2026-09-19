"""Cheap model calls with a fallback chain: Gemini, then Groq, then Haiku, then OpenAI.

Every feature that asks a model something goes through `ask`. Each provider is skipped when
its key is unset, so one key is enough and four is redundancy. A provider is abandoned for
the next on any HTTP failure (timeout, 429, 5xx, a revoked key) or on an answer the caller
cannot use; the chain only gives up when every configured provider has.

Two outcomes are kept apart on purpose:

- **Every provider failed to answer** raises `AIUnavailable`. The caller degrades to typing.
- **Somebody answered, but nothing usable** returns None. That is a real answer - "could
  not tell" - and the caller treats it exactly like a person leaving the field blank.

Models are asked for identity and for choices between catalog rows. Never for value: prices
come from the catalog feed, and an invented number on real money is worse than no number.
"""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import TypeVar

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_TIMEOUT_SECONDS = 30.0

#: Enough for a JSON list of a dozen cards, with room for a reasoning model's hidden
#: tokens. Anthropic requires a ceiling; the others get the same one so no provider can
#: run up a long answer on a short question.
MAX_OUTPUT_TOKENS = 2048

_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_GROQ = "https://api.groq.com/openai/v1/chat/completions"
_ANTHROPIC = "https://api.anthropic.com/v1/messages"
_OPENAI = "https://api.openai.com/v1/chat/completions"

#: What each provider accepts as an image. HEIC is an iPhone default only Gemini reads.
_COMMON_IMAGES = frozenset({"image/jpeg", "image/png", "image/webp"})
_GEMINI_IMAGES = _COMMON_IMAGES | {"image/heic"}


class AIUnavailable(RuntimeError):
    """No provider is configured, or every configured one failed to answer."""


@dataclass(frozen=True)
class Image:
    data: bytes
    content_type: str


@dataclass(frozen=True)
class _Provider:
    name: str
    key: Callable[[], str]
    images: frozenset[str]
    request: Callable[[str, Image | None], tuple[str, dict, dict]]
    text: Callable[[dict], str]


def _b64(image: Image) -> str:
    return base64.b64encode(image.data).decode()


def _gemini(prompt: str, image: Image | None) -> tuple[str, dict, dict]:
    parts: list[dict] = [{"text": prompt}]
    if image is not None:
        parts.append({"inline_data": {"mime_type": image.content_type, "data": _b64(image)}})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
        },
    }
    # The key goes in a header rather than the query string, so it cannot end up in
    # anybody's access log.
    headers = {"x-goog-api-key": settings.gemini_api_key}
    return _GEMINI.format(model=settings.gemini_model), body, headers


def _chat(url: str, key: Callable[[], str], model: Callable[[], str]):
    """OpenAI's chat format, which Groq speaks too."""

    def build(prompt: str, image: Image | None) -> tuple[str, dict, dict]:
        content: list[dict] = [{"type": "text", "text": prompt}]
        if image is not None:
            data_url = f"data:{image.content_type};base64,{_b64(image)}"
            content.append({"type": "image_url", "image_url": {"url": data_url}})
        body = {
            "model": model(),
            "messages": [{"role": "user", "content": content}],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": MAX_OUTPUT_TOKENS,
        }
        return url, body, {"Authorization": f"Bearer {key()}"}

    return build


def _anthropic(prompt: str, image: Image | None) -> tuple[str, dict, dict]:
    content: list[dict] = []
    if image is not None:
        content.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": image.content_type, "data": _b64(image)},
            }
        )
    content.append({"type": "text", "text": prompt})
    body = {
        "model": settings.anthropic_model,
        "max_tokens": MAX_OUTPUT_TOKENS,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01"}
    return _ANTHROPIC, body, headers


def _gemini_text(payload: dict) -> str:
    return payload["candidates"][0]["content"]["parts"][0]["text"]


def _chat_text(payload: dict) -> str:
    return payload["choices"][0]["message"]["content"]


def _anthropic_text(payload: dict) -> str:
    return next(block["text"] for block in payload["content"] if block.get("type") == "text")


#: Cheapest and most accurate first. Order is product judgement, not configuration: it
#: only matters when the one ahead fails, and then any answer beats typing.
PROVIDERS: tuple[_Provider, ...] = (
    _Provider("gemini", lambda: settings.gemini_api_key, _GEMINI_IMAGES, _gemini, _gemini_text),
    _Provider(
        "groq",
        lambda: settings.groq_api_key,
        _COMMON_IMAGES,
        _chat(_GROQ, lambda: settings.groq_api_key, lambda: settings.groq_model),
        _chat_text,
    ),
    _Provider(
        "anthropic",
        lambda: settings.anthropic_api_key,
        _COMMON_IMAGES,
        _anthropic,
        _anthropic_text,
    ),
    _Provider(
        "openai",
        lambda: settings.openai_api_key,
        _COMMON_IMAGES,
        _chat(_OPENAI, lambda: settings.openai_api_key, lambda: settings.openai_model),
        _chat_text,
    ),
)


def is_configured() -> bool:
    return any(provider.key() for provider in PROVIDERS)


def clean_json(text: str) -> str:
    """Models wrap JSON in code fences often enough to be worth handling."""
    return text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")


def ask(
    prompt: str,
    parse: Callable[[str], T | None],
    *,
    image: Image | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> T | None:
    """The first usable answer from the chain, None when all answers were unusable.

    `parse` turns the model's text into a result, or None when it cannot use it - which
    moves on to the next provider rather than handing back a malformed guess.
    """
    answered = False
    for provider in PROVIDERS:
        if not provider.key():
            continue
        if image is not None and image.content_type not in provider.images:
            continue
        url, body, headers = provider.request(prompt, image)
        try:
            response = httpx.post(url, json=body, headers=headers, timeout=timeout)
            response.raise_for_status()
        except httpx.HTTPError as error:
            # Never the body: it can echo the request, and the request carries the key.
            logger.warning(
                "ai_call_failed provider=%s error=%s", provider.name, type(error).__name__
            )
            continue
        answered = True
        try:
            text = provider.text(response.json())
        except (ValueError, KeyError, IndexError, TypeError, StopIteration):
            logger.warning("ai_answer_malformed provider=%s", provider.name)
            continue
        result = parse(text) if isinstance(text, str) else None
        if result is not None:
            return result
        logger.info("ai_answer_unusable provider=%s", provider.name)
    if not answered:
        raise AIUnavailable("No model could be reached.")
    return None


_CHOOSE_PROMPT = """You are matching a trading card product to a catalog.

The product is:
{subject}

The catalog entries are:
{options}

Which entry is exactly the same product - same set, same product, same variant? A close
name is not enough. If none is certainly the same, or you are unsure, answer null.

Return only JSON: {{"match": <entry number or null>}}"""


def choose(subject: str, options: Sequence[str]) -> int | None:
    """Which option is the same thing as `subject`, as an index, or None when none is.

    For the cases code cannot settle on its own: a set named differently in two places, a
    sealed product whose catalog title is worded its own way. The answer is a suggestion a
    person confirms, and an out-of-range or unsure answer counts as no match.
    """
    if not options:
        return None
    listed = "\n".join(f"{number}. {option}" for number, option in enumerate(options, 1))

    def parse(text: str) -> int | None:
        try:
            match = json.loads(clean_json(text))["match"]
        except (json.JSONDecodeError, KeyError, TypeError):
            return None
        if match is None:
            return _NO_MATCH
        if isinstance(match, bool) or not isinstance(match, int):
            return None
        return match - 1 if 1 <= match <= len(options) else _NO_MATCH

    found = ask(_CHOOSE_PROMPT.format(subject=subject, options=listed), parse)
    return None if found in (None, _NO_MATCH) else found


#: "Answered, and the answer is none of them" - distinct from an answer nobody could read,
#: which moves on to the next provider.
_NO_MATCH = -1
