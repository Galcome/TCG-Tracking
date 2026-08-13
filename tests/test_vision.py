"""Reading card names off a photo.

Eyes, not judgement. The model fills in fields; a person presses save. It is never asked
what anything is worth, and it never writes to the ledger.

The three rules this file exists to hold:

**Unsure comes back blank, never guessed.** A wrong card name mints a phantom product that
then splits every report - Fable/Fabled arriving by camera.

**It degrades to typing.** No key, a failed call, a rate limit, a malformed answer: the
screen still works, it just has nothing to prefill.

**No value, ever.** Not in the prompt, not in the response, not in the model.
"""

import httpx
import pytest

from src.config import settings
from src.services import vision

PIXEL = b"\x89PNG\r\n\x1a\n" + b"0" * 64


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """Each test starts with the throttle clear, so ordering cannot make one flake."""
    vision._last_call_at = 0.0
    yield
    vision._last_call_at = 0.0


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    return settings


def gemini(text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def post_photo(client, content_type="image/jpeg"):
    return client.post(
        "/api/v1/vision/cards",
        files={"photo": ("hits.jpg", PIXEL, content_type)},
    )


# ------------------------------------------------------------------- switched off


def test_with_no_key_the_feature_says_it_is_not_available(client):
    """The client hides the button rather than offering something that always fails."""
    body = client.get("/api/v1/vision/status").json()
    assert body["available"] is False
    assert body["cards"] == []


def test_with_no_key_reading_a_photo_is_refused_gracefully(client):
    """503, not 500. Nothing is broken - the accelerator is simply not there."""
    response = post_photo(client)
    assert response.status_code == 503
    assert "No vision key" in response.json()["detail"]


def test_with_a_key_it_says_it_is_available(client, keyed):
    assert client.get("/api/v1/vision/status").json()["available"] is True


# ---------------------------------------------------------------------- reading


def test_it_reads_the_cards_out_of_a_photo(client, keyed, monkeypatch):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200,
            json=gemini(
                '{"cards": [{"name": "Mickey Mouse", "set": "Fabled", '
                '"variant": "Iconic foil"}]}'
            ),
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )

    body = post_photo(client).json()

    assert body["cards"] == [
        {"name": "Mickey Mouse", "set_name": "Fabled", "variant": "Iconic foil"}
    ]


def test_what_it_is_unsure_of_comes_back_blank(client, keyed, monkeypatch):
    """The risky field is the variant, not the character. Blank beats a guess.

    An Iconic foil against a regular is a tiny set symbol and a treatment, and that
    distinction is $560 against about $2.
    """
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200,
            json=gemini('{"cards": [{"name": "Mickey Mouse", "set": "", "variant": ""}]}'),
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )

    card = post_photo(client).json()["cards"][0]
    assert card["name"] == "Mickey Mouse"
    assert card["set_name"] == ""
    assert card["variant"] == ""


def test_a_card_with_no_name_is_dropped(client, keyed, monkeypatch):
    """A blank row somebody has to notice and delete is worse than no row.

    The bare string in the middle is a model returning something that is not a card object
    at all - it gets skipped rather than crashing the read.
    """
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200,
            json=gemini(
                '{"cards": [{"name": "", "set": "Fabled"}, "not an object", '
                '{"name": "Real One"}]}'
            ),
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )

    assert [card["name"] for card in post_photo(client).json()["cards"]] == ["Real One"]


def test_a_fenced_answer_is_still_understood(client, keyed, monkeypatch):
    """Models wrap JSON in code fences often enough to be worth handling."""
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200,
            json=gemini('```json\n{"cards": [{"name": "Fenced Card"}]}\n```'),
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )

    assert post_photo(client).json()["cards"][0]["name"] == "Fenced Card"


# ------------------------------------------------------------------- falling back


@pytest.mark.parametrize(
    "text",
    [
        "I am afraid I cannot help with that",
        '{"not_cards": []}',
        '{"cards": "a string"}',
        "{malformed",
    ],
)
def test_an_answer_it_cannot_read_returns_nothing(client, keyed, monkeypatch, text):
    """Prose, the wrong shape, or broken JSON. The screen still works, it just has
    nothing to prefill - which is the same thing as typing."""
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200, json=gemini(text), request=httpx.Request("POST", "https://example.invalid")
        ),
    )

    assert post_photo(client).json()["cards"] == []


def test_a_response_of_an_unexpected_shape_returns_nothing(client, keyed, monkeypatch):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200, json={"nothing": "useful"}, request=httpx.Request("POST", "https://x.invalid")
        ),
    )

    assert post_photo(client).json()["cards"] == []


def test_a_failed_call_falls_back_to_typing(client, keyed, monkeypatch):
    def explode(*args, **kwargs):
        raise httpx.ConnectError("no route to host")

    monkeypatch.setattr(httpx, "post", explode)

    response = post_photo(client)
    assert response.status_code == 503
    assert "Type them in instead" in response.json()["detail"]


def test_an_error_status_falls_back_to_typing(client, keyed, monkeypatch):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            429, json={}, request=httpx.Request("POST", "https://example.invalid")
        ),
    )

    assert post_photo(client).status_code == 503


def test_photos_are_throttled(client, keyed, monkeypatch):
    """A retry loop against a free tier is how the free tier stops being free."""
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *args, **kwargs: httpx.Response(
            200,
            json=gemini('{"cards": [{"name": "First"}]}'),
            request=httpx.Request("POST", "https://example.invalid"),
        ),
    )

    assert post_photo(client).status_code == 200
    second = post_photo(client)
    assert second.status_code == 503
    assert "few seconds" in second.json()["detail"]


def test_something_that_is_not_an_image_is_refused(client, keyed):
    response = client.post(
        "/api/v1/vision/cards",
        files={"photo": ("notes.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 422


def test_an_enormous_photo_is_refused_before_it_is_sent(client, keyed):
    response = client.post(
        "/api/v1/vision/cards",
        files={"photo": ("huge.jpg", b"0" * (vision.MAX_IMAGE_BYTES + 1), "image/jpeg")},
    )
    assert response.status_code == 503
    assert "too large" in response.json()["detail"]


# --------------------------------------------------------------------- discipline


def test_it_is_never_asked_what_anything_is_worth():
    """Not in the prompt, not in the response model, not in the feature.

    AI-estimated values or sell recommendations are confident guessing dressed as advice,
    on real money, in an app whose whole discipline is refusing to invent financial data.
    """
    prompt = vision._PROMPT.lower()
    assert "do not estimate value" in prompt

    # The only mention of money in the whole prompt is the sentence forbidding it.
    without_the_prohibition = prompt.replace(
        "do not estimate value, condition, rarity or price.", ""
    )
    for forbidden in ("price", "worth", "how much", "recommend"):
        assert forbidden not in without_the_prohibition


def test_the_model_is_configuration_and_not_baked_in(client, keyed, monkeypatch):
    """A pinned model expires, and the mocked suite cannot see it happen.

    This shipped hardcoded to `gemini-2.0-flash`. Google retired that generation and the
    live API answers `404 - no longer available`, so every photo degraded to typing while
    every test in this file still passed. They mock the call; the model name was the one
    thing no mock could check. Now it comes from settings, and a bad rollout is an env
    var away from being fixed rather than a deploy.
    """
    seen: dict = {}

    def capture(url, **kwargs):
        seen["url"] = url
        return httpx.Response(
            200,
            json=gemini('{"cards": []}'),
            request=httpx.Request("POST", "https://example.invalid"),
        )

    monkeypatch.setattr(httpx, "post", capture)
    monkeypatch.setattr(settings, "gemini_model", "some-other-model")
    post_photo(client)

    assert "some-other-model:generateContent" in seen["url"]


def test_the_default_model_is_not_a_pinned_version(client, keyed):
    """`-latest` tracks the current generation, so it cannot rot the way 2.0 did."""
    assert settings.gemini_model.endswith("-latest")


def test_the_key_never_reaches_the_query_string(client, keyed, monkeypatch):
    """A key in a URL ends up in access logs. It goes in a header."""
    seen: dict = {}

    def capture(url, **kwargs):
        seen["url"] = url
        seen["headers"] = kwargs.get("headers", {})
        return httpx.Response(
            200,
            json=gemini('{"cards": []}'),
            request=httpx.Request("POST", "https://example.invalid"),
        )

    monkeypatch.setattr(httpx, "post", capture)
    post_photo(client)

    assert "test-key" not in seen["url"]
    assert seen["headers"]["x-goog-api-key"] == "test-key"
