"""Set calendar sync from the TCGCSV catalog.

What matters: a new release shows up by itself, a set we already have is linked rather
than duplicated (even when the seed guessed its name wrong), junk groups and republished
legacy groups stay out, and a second run changes nothing.
"""

from datetime import date

import pytest
from sqlalchemy import func, select

from src.models.card_set import CardSet
from src.models.taxonomy import Game
from src.services import set_sync
from src.services.pricing import CatalogGroup, PricingError

TODAY = date(2026, 9, 19)
POKEMON = 3
LORCANA = 71


def group(group_id: int, name: str, published_on: str | None, category_id: int = POKEMON):
    return CatalogGroup(group_id, category_id, name, None, published_on)


class FakeProvider:
    def __init__(
        self, groups: dict[int, list[CatalogGroup]], failing: frozenset[int] = frozenset()
    ):
        self._groups = groups
        self._failing = failing
        self.calls: list[int] = []

    def groups(self, category_id: int) -> list[CatalogGroup]:
        self.calls.append(category_id)
        if category_id in self._failing:
            raise PricingError("TCGCSV catalog response was invalid")
        return self._groups.get(category_id, [])


def run(db, groups: dict[int, list[CatalogGroup]], **kwargs) -> set_sync.SyncSummary:
    return set_sync.sync(db, provider=FakeProvider(groups, **kwargs), today=TODAY)


def find(db, slug: str, name: str) -> CardSet | None:
    return db.scalars(
        select(CardSet)
        .join(Game, Game.id == CardSet.game_id)
        .where(Game.slug == slug, func.lower(CardSet.name) == name.lower())
    ).first()


# ------------------------------------------------------------------- parsing


@pytest.mark.parametrize(
    ("stamp", "expected"),
    [
        ("2026-09-16T00:00:00", date(2026, 9, 16)),
        ("2026-09-16T00:00:00Z", date(2026, 9, 16)),
        # A republished legacy group carries the publish instant, not a release date.
        ("2026-09-18T20:00:06.6501221Z", None),
        ("not a date", None),
        ("", None),
        (None, None),
    ],
)
def test_only_a_midnight_stamp_is_a_release_date(stamp, expected):
    assert set_sync.release_date(stamp) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ME06: Delta Reign", "Delta Reign"),
        ("ME: 30th Celebration", "30th Celebration"),
        ("SV03.5: Pokemon 151", "Pokemon 151"),
        ("Commander: Star Trek", "Commander: Star Trek"),
        ("Hyperia City", "Hyperia City"),
        ("SV: ", "SV:"),
    ],
)
def test_set_codes_are_stripped_from_names(raw, expected):
    assert set_sync.display_name(raw) == expected


# ------------------------------------------------------------------- linking


def test_a_seeded_set_is_linked_by_name_and_keeps_its_row(db):
    seeded = find(db, "pokemon", "30th Celebration")

    summary = run(
        db,
        {
            POKEMON: [
                # Listed first on purpose: it must not claim the seed by similarity.
                group(24837, "ME: 30th Celebration Classic Collection", "2026-09-16T00:00:00"),
                group(24722, "ME: 30th Celebration", "2026-09-16T00:00:00"),
            ]
        },
    )

    assert seeded.tcgcsv_group_id == 24722
    classic = find(db, "pokemon", "30th Celebration Classic Collection")
    assert classic.tcgcsv_group_id == 24837
    assert classic.released_on == date(2026, 9, 16)
    assert (summary.linked, summary.created) == (1, 1)


def test_a_misnamed_seed_is_linked_by_date_and_takes_the_catalog_name(db):
    seeded = find(db, "pokemon", "Mega Evolution: Rising Chaos")

    run(db, {POKEMON: [group(24655, "ME04: Chaos Rising", "2026-05-22T00:00:00")]})

    assert seeded.tcgcsv_group_id == 24655
    assert seeded.name == "Chaos Rising"
    assert find(db, "pokemon", "Mega Evolution: Rising Chaos") is None


def test_a_seed_with_the_wrong_date_is_corrected(db):
    seeded = find(db, "pokemon", "Mega Evolution: Perfect Order")

    run(db, {POKEMON: [group(24587, "ME03: Perfect Order", "2026-03-27T00:00:00")]})

    assert seeded.released_on == date(2026, 3, 27)
    assert seeded.name == "Perfect Order"


def test_a_seed_keeps_its_name_when_the_catalog_name_is_taken(db, game_id):
    db.add(CardSet(game_id=game_id, name="Pitch Black", released_on=date(2020, 1, 1)))
    db.flush()
    seeded = find(db, "pokemon", "Mega Evolution: Pitch Black Night")

    run(db, {POKEMON: [group(24688, "ME05: Pitch Black", "2026-07-17T00:00:00")]})

    # The exact-name pass links the existing "Pitch Black" instead; the seed is untouched.
    assert find(db, "pokemon", "Pitch Black").tcgcsv_group_id == 24688
    assert seeded.tcgcsv_group_id is None


def test_a_rename_that_would_collide_is_skipped(db, game_id):
    seeded = CardSet(game_id=game_id, name="Seeded Guess", released_on=date(2026, 8, 1))
    taken = CardSet(
        game_id=game_id,
        name="Seeded Guess Proper",
        released_on=date(2019, 1, 1),
        tcgcsv_group_id=990001,
    )
    db.add_all([seeded, taken])
    db.flush()

    run(db, {POKEMON: [group(990002, "XX: Seeded Guess Proper", "2026-08-01T00:00:00")]})

    assert seeded.tcgcsv_group_id == 990002
    assert seeded.name == "Seeded Guess"


def test_a_set_somebody_typed_keeps_their_name_and_gains_a_date(db, make_product):
    make_product("Typed Box", set_name="Hand Typed Set")
    typed = find(db, "pokemon", "hand typed set")

    run(db, {POKEMON: [group(990003, "HT: Hand Typed Set", "2026-09-01T00:00:00")]})

    assert typed.tcgcsv_group_id == 990003
    assert typed.name == "Hand Typed Set"
    assert typed.released_on == date(2026, 9, 1)


def test_a_typed_set_with_a_date_keeps_it(db, make_product):
    make_product("Dated Box", set_name="Dated Typed Set")
    typed = find(db, "pokemon", "Dated Typed Set")
    typed.released_on = date(2026, 8, 30)
    db.flush()

    run(db, {POKEMON: [group(990004, "Dated Typed Set", "2026-09-01T00:00:00")]})

    assert typed.released_on == date(2026, 8, 30)


# ------------------------------------------------------------------- creating


def test_a_new_release_is_created_for_its_own_game(db):
    summary = run(
        db, {LORCANA: [group(24740, "Hyperia City", "2026-10-16T00:00:00", LORCANA)]}
    )

    created = find(db, "lorcana", "Hyperia City")
    assert created.tcgcsv_group_id == 24740
    assert created.released_on == date(2026, 10, 16)
    assert created.created_by_member_id is None
    assert summary.created == 1


@pytest.mark.parametrize(
    "skipped",
    [
        group(990010, "ME: Mega Evolution Promo", "2026-09-01T00:00:00"),
        group(990011, "Prize Pack Series Nine", "2026-09-01T00:00:00"),
        group(990012, "MEE: Mega Evolution Energies", "2026-09-01T00:00:00"),
        group(990013, "Some Set Pre-release Cards", "2026-09-01T00:00:00"),
        group(990014, "POP Series 1", "2026-09-18T20:00:06.6501221Z"),
        group(990015, "Long Ago Set", "2024-01-01T00:00:00"),
        group(990016, "Undated Set", None),
    ],
)
def test_groups_that_are_not_recent_releases_are_skipped(db, skipped):
    summary = run(db, {POKEMON: [skipped]})

    assert summary.created == summary.linked == 0
    assert db.scalar(
        select(CardSet.id).where(CardSet.tcgcsv_group_id == skipped.group_id)
    ) is None


def test_a_group_whose_name_is_already_taken_is_not_duplicated(db, game_id):
    db.add(
        CardSet(
            game_id=game_id,
            name="Already Linked",
            released_on=date(2019, 1, 1),
            tcgcsv_group_id=990020,
        )
    )
    db.flush()

    summary = run(db, {POKEMON: [group(990021, "AL: Already Linked", "2026-09-01T00:00:00")]})

    assert summary.created == 0
    assert db.scalar(select(CardSet.id).where(CardSet.tcgcsv_group_id == 990021)) is None


def test_a_second_run_changes_nothing(db):
    groups = {
        POKEMON: [group(24722, "ME: 30th Celebration", "2026-09-16T00:00:00")],
        LORCANA: [group(24740, "Hyperia City", "2026-10-16T00:00:00", LORCANA)],
    }
    first = run(db, groups)
    second = run(db, groups)

    assert (first.created, first.linked) == (1, 1)
    assert (second.created, second.linked) == (0, 0)


def test_one_game_failing_does_not_stop_the_others(db):
    summary = run(
        db,
        {LORCANA: [group(24740, "Hyperia City", "2026-10-16T00:00:00", LORCANA)]},
        failing=frozenset({POKEMON}),
    )

    assert summary.errors == ("pokemon: TCGCSV catalog response was invalid",)
    assert find(db, "lorcana", "Hyperia City") is not None


def test_only_games_with_a_catalog_are_asked(db):
    provider = FakeProvider({})
    summary = set_sync.sync(db, provider=provider, today=TODAY)

    synced = set(
        db.scalars(select(Game.tcgcsv_category_id).where(Game.tcgcsv_category_id.is_not(None)))
    )
    assert set(provider.calls) == synced
    assert summary.games == len(synced)
    assert {POKEMON, LORCANA} <= synced
    assert db.scalar(select(Game.tcgcsv_category_id).where(Game.slug == "sports")) is None


def test_defaults_build_a_real_provider_and_use_today(db, monkeypatch):
    seen = {}

    class Recorder(FakeProvider):
        def __init__(self):
            super().__init__({})
            seen["built"] = True

    monkeypatch.setattr(set_sync, "TCGCSVProvider", Recorder)

    assert set_sync.sync(db).errors == ()
    assert seen == {"built": True}
