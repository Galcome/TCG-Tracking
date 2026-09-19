"""The model fallback chain: Gemini, then Groq, then Haiku, then OpenAI.

What matters: one outage is not the feature's outage, a garbled answer is never passed off
as a real one, a provider without a key costs nothing, and "could not tell" is kept apart
from "could not reach anybody".
"""

import json

import httpx
import pytest

from src.config import settings
from src.services import ai, vision

PNG = ai.Image(b"\x89PNG\r\n\x1a\n", "image/png")

GEMINI = "generativelanguage.googleapis.com"
GROQ = "api.groq.com"
ANTHROPIC = "api.anthropic.com"
OPENAI = "api.openai.com"


def gemini_reply(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def chat_reply(text: str) -> dict:
    return {"choices": [{"message": {"content": text}}]}


def anthropic_reply(text: str) -> dict:
    return {"content": [{"type": "thinking", "thinking": "..."}, {"type": "text", "text": text}]}


REPLY = {GEMINI: gemini_reply, GROQ: chat_reply, ANTHROPIC: anthropic_reply, OPENAI: chat_reply}


@pytest.fixture
def all_keys(monkeypatch):
    for name in ("gemini", "groq", "anthropic", "openai"):
        monkeypatch.setattr(settings, f"{name}_api_key", f"{name}-key")


class Network:
    """Answers per host: a text, an HTTP status, an exception, or a raw payload."""

    def __init__(self, monkeypatch, **answers):
        self.answers = {host: answers.get(key) for key, host in _HOSTS.items()}
        self.calls: list[dict] = []
        monkeypatch.setattr(httpx, "post", self.post)

    @property
    def hosts(self) -> list[str]:
        return [call["host"] for call in self.calls]

    def post(self, url, *, json, headers, timeout):
        host = httpx.URL(url).host
        self.calls.append(
            {"host": host, "url": url, "body": json, "headers": headers, "timeout": timeout}
        )
        answer = self.answers[host]
        request = httpx.Request("POST", url)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, int):
            return httpx.Response(answer, json={}, request=request)
        if isinstance(answer, dict):
            return httpx.Response(200, json=answer, request=request)
        if isinstance(answer, bytes):
            return httpx.Response(200, content=answer, request=request)
        return httpx.Response(200, json=REPLY[host](answer), request=request)


_HOSTS = {"gemini": GEMINI, "groq": GROQ, "anthropic": ANTHROPIC, "openai": OPENAI}


def as_dict(text: str) -> dict | None:
    try:
        value = json.loads(ai.clean_json(text))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) and value.get("ok") else None


# ------------------------------------------------------------------- the chain


def test_the_first_provider_answers_and_nobody_else_is_paid(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini='{"ok": 1}')

    assert ai.ask("q", as_dict) == {"ok": 1}
    assert network.hosts == [GEMINI]


@pytest.mark.parametrize(
    "failure",
    [
        429,
        500,
        401,
        httpx.ReadTimeout("slow"),
        httpx.ConnectError("down"),
        {"unexpected": "shape"},
        b"not json at all",
        "prose, not the promised JSON",
    ],
)
def test_a_failure_moves_on_to_the_next_provider(monkeypatch, all_keys, failure):
    network = Network(monkeypatch, gemini=failure, groq='{"ok": "groq"}')

    assert ai.ask("q", as_dict) == {"ok": "groq"}
    assert network.hosts == [GEMINI, GROQ]


def test_the_whole_chain_is_walked_in_order(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini=503, groq=503, anthropic=503, openai='{"ok": "luna"}')

    assert ai.ask("q", as_dict) == {"ok": "luna"}
    assert network.hosts == [GEMINI, GROQ, ANTHROPIC, OPENAI]


def test_a_provider_without_a_key_is_skipped(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "only-this-one")
    network = Network(monkeypatch, anthropic='{"ok": "haiku"}')

    assert ai.ask("q", as_dict) == {"ok": "haiku"}
    assert network.hosts == [ANTHROPIC]


def test_nobody_configured_is_unavailable(monkeypatch):
    network = Network(monkeypatch)

    assert ai.is_configured() is False
    with pytest.raises(ai.AIUnavailable):
        ai.ask("q", as_dict)
    assert network.calls == []


def test_nobody_reachable_is_unavailable(monkeypatch, all_keys):
    Network(monkeypatch, gemini=500, groq=429, anthropic=httpx.ReadTimeout("x"), openai=502)

    with pytest.raises(ai.AIUnavailable):
        ai.ask("q", as_dict)


def test_answers_nobody_can_use_are_none_not_unavailable(monkeypatch, all_keys):
    """Somebody answered. "Could not tell" is an answer; the caller leaves the field blank."""
    Network(monkeypatch, gemini="no", groq="no", anthropic="no", openai="no")

    assert ai.ask("q", as_dict) is None


def test_an_image_goes_only_to_providers_that_read_its_type(monkeypatch, all_keys):
    """HEIC is the iPhone default and only Gemini reads it; the rest are not paid to fail."""
    network = Network(monkeypatch, gemini=500)

    with pytest.raises(ai.AIUnavailable):
        ai.ask("q", as_dict, image=ai.Image(b"heic", "image/heic"))
    assert network.hosts == [GEMINI]


def test_the_timeout_is_passed_through(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini='{"ok": 1}')

    ai.ask("q", as_dict, timeout=4.0)

    assert network.calls[0]["timeout"] == 4.0


# ------------------------------------------------------------ request shapes


def test_each_provider_gets_its_own_request_shape(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini=500, groq=500, anthropic=500, openai=500)
    monkeypatch.setattr(settings, "gemini_model", "gemini-x")
    monkeypatch.setattr(settings, "groq_model", "groq-x")
    monkeypatch.setattr(settings, "anthropic_model", "haiku-x")
    monkeypatch.setattr(settings, "openai_model", "luna-x")

    with pytest.raises(ai.AIUnavailable):
        ai.ask("read this", as_dict, image=PNG)
    gemini, groq, anthropic, openai = network.calls
    encoded = "iVBORw0KGgo="

    assert gemini["url"].endswith("/models/gemini-x:generateContent")
    assert gemini["headers"] == {"x-goog-api-key": "gemini-key"}
    assert gemini["body"]["contents"][0]["parts"] == [
        {"text": "read this"},
        {"inline_data": {"mime_type": "image/png", "data": encoded}},
    ]

    assert groq["body"]["model"] == "groq-x"
    assert groq["headers"] == {"Authorization": "Bearer groq-key"}
    assert groq["body"]["messages"][0]["content"][1] == {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{encoded}"},
    }

    assert anthropic["body"]["model"] == "haiku-x"
    assert anthropic["headers"]["x-api-key"] == "anthropic-key"
    assert anthropic["body"]["messages"][0]["content"][0]["source"] == {
        "type": "base64",
        "media_type": "image/png",
        "data": encoded,
    }

    assert openai["url"] == "https://api.openai.com/v1/chat/completions"
    assert openai["body"]["model"] == "luna-x"
    assert openai["headers"] == {"Authorization": "Bearer openai-key"}


def test_a_text_question_carries_no_image(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini=500, groq=500, anthropic=500, openai=500)

    with pytest.raises(ai.AIUnavailable):
        ai.ask("just text", as_dict)
    gemini, groq, anthropic, openai = network.calls

    assert gemini["body"]["contents"][0]["parts"] == [{"text": "just text"}]
    assert groq["body"]["messages"][0]["content"] == [{"type": "text", "text": "just text"}]
    assert anthropic["body"]["messages"][0]["content"] == [{"type": "text", "text": "just text"}]
    assert openai["body"]["messages"][0]["content"] == [{"type": "text", "text": "just text"}]


def test_no_key_ever_reaches_a_url(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini=500, groq=500, anthropic=500, openai=500)

    with pytest.raises(ai.AIUnavailable):
        ai.ask("q", as_dict)

    for call in network.calls:
        assert "-key" not in call["url"]


def test_a_failure_log_never_carries_the_body(monkeypatch, all_keys, caplog):
    Network(monkeypatch, gemini=httpx.ConnectError("gemini-key leaked?"), groq='{"ok": 1}')

    ai.ask("q", as_dict)

    assert "ai_call_failed provider=gemini error=ConnectError" in caplog.text
    assert "gemini-key" not in caplog.text


# ------------------------------------------------------------------ choosing


OPTIONS = ["30th Celebration", "30th Celebration Classic Collection", "Chaos Rising"]


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ('{"match": 2}', 1),
        ('```json\n{"match": 1}\n```', 0),
        ('{"match": null}', None),
        ('{"match": 9}', None),
        ('{"match": 0}', None),
    ],
)
def test_choose_returns_the_matching_option(monkeypatch, all_keys, answer, expected):
    Network(monkeypatch, gemini=answer)

    assert ai.choose("ME: 30th Celebration Classic Collection", OPTIONS) == expected


@pytest.mark.parametrize("garbled", ['{"match": "2"}', '{"match": true}', '{"other": 1}', "no"])
def test_choose_moves_on_when_an_answer_is_garbled(monkeypatch, all_keys, garbled):
    network = Network(monkeypatch, gemini=garbled, groq='{"match": 3}')

    assert ai.choose("ME04: Chaos Rising", OPTIONS) == 2
    assert network.hosts == [GEMINI, GROQ]


def test_choose_lists_every_option_numbered(monkeypatch, all_keys):
    network = Network(monkeypatch, gemini='{"match": null}')

    ai.choose("subject line", OPTIONS)

    prompt = network.calls[0]["body"]["contents"][0]["parts"][0]["text"]
    assert "subject line" in prompt
    assert "1. 30th Celebration\n2. 30th Celebration Classic Collection\n3. Chaos Rising" in prompt
    assert "price" not in prompt.lower()


def test_choose_with_nothing_to_choose_from_asks_nobody(monkeypatch, all_keys):
    network = Network(monkeypatch)

    assert ai.choose("anything", []) is None
    assert network.calls == []


def test_choose_when_nobody_answers_is_unavailable(monkeypatch, all_keys):
    Network(monkeypatch, gemini=500, groq=500, anthropic=500, openai=500)

    with pytest.raises(ai.AIUnavailable):
        ai.choose("anything", OPTIONS)


# -------------------------------------------------------------- through vision


def test_a_photo_is_read_by_the_fallback_when_gemini_is_down(monkeypatch, all_keys):
    vision._usage.clear()
    Network(monkeypatch, gemini=503, groq='{"cards": [{"name": "Pikachu", "set": "151"}]}')

    cards = vision.read_cards(PNG.data, PNG.content_type)

    assert [(card.name, card.set_name) for card in cards] == [("Pikachu", "151")]
    vision._usage.clear()


def test_an_honest_empty_photo_is_not_sent_down_the_chain(monkeypatch, all_keys):
    """No card it could name is a real answer; three more providers agreeing costs money."""
    vision._usage.clear()
    network = Network(monkeypatch, gemini='{"cards": []}')

    assert vision.read_cards(PNG.data, PNG.content_type) == []
    assert network.hosts == [GEMINI]
    vision._usage.clear()
