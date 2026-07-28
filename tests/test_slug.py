"""Tests for slug generation."""

import pytest

from src.services.slug import SLUG_MAX_LENGTH, slugify


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Pokémon", "pokemon"),
        ("Magic: The Gathering", "magic-the-gathering"),
        ("Yu-Gi-Oh!", "yu-gi-oh"),
        ("  Flesh and Blood  ", "flesh-and-blood"),
        ("One   Piece", "one-piece"),
        ("Sorcery", "sorcery"),
        ("Booster Box (1st Edition)", "booster-box-1st-edition"),
    ],
)
def test_slugify_produces_expected_slugs(name: str, expected: str):
    assert slugify(name) == expected


@pytest.mark.parametrize("name", ["", "   ", "!!!", "???", "日本語"])
def test_slugify_returns_empty_when_nothing_usable_survives(name: str):
    """Callers must reject these rather than storing a blank slug."""
    assert slugify(name) == ""


def test_slugify_truncates_without_leaving_a_trailing_hyphen():
    slug = slugify("a" * 59 + " " + "b" * 20)
    assert len(slug) <= SLUG_MAX_LENGTH
    assert not slug.endswith("-")
