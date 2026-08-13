"""Sets: one record per release, suggested well, and never duplicated by accident.

The failure this exists to prevent is quiet. "Fable", "Fabled" and "Lorcana Fable" as three
rows do not look wrong anywhere - until a set rollup splits across all three and undercounts
every one of them. So the tests care most about two things: that the same set typed two ways
lands on one record, and that a near miss is questioned before it becomes a duplicate.
"""

from datetime import date, timedelta

from sqlalchemy import select

from src.models.card_set import CardSet
from src.models.taxonomy import Game
from src.services import sets

TODAY = date.today()


def suggest(client, game: str = "pokemon", **params) -> dict:
    response = client.get("/api/v1/sets", params={"game": game, **params})
    assert response.status_code == 200, response.text
    return response.json()


def names(client, game: str = "pokemon", **params) -> list[str]:
    return [item["name"] for item in suggest(client, game, **params)["items"]]


# ------------------------------------------------------------------- the calendar


def test_the_calendar_is_seeded_and_offered(client):
    """A brand-new set is one tap before anybody has bought it."""
    assert "Mega Evolution: Pitch Black Night" in names(client, limit=30)


def test_a_set_stays_hidden_until_its_release_date(client, db, game_id):
    """The whole reason the calendar needs no maintenance: sets reveal themselves."""
    future = CardSet(
        game_id=game_id, name="Not Out Yet", released_on=TODAY + timedelta(days=30)
    )
    db.add(future)
    db.flush()

    assert "Not Out Yet" not in names(client, limit=30)


def test_a_set_appears_on_the_day_itself(client, db, game_id):
    released = CardSet(game_id=game_id, name="Out Today", released_on=TODAY)
    db.add(released)
    db.flush()

    assert "Out Today" in names(client, limit=30)


def test_a_pre_order_makes_an_unreleased_set_visible(client, db, game_id, product_type_id):
    """Cases get bought before release day. Once something uses a set, it is real."""
    future = CardSet(
        game_id=game_id, name="Pre Ordered", released_on=TODAY + timedelta(days=30)
    )
    db.add(future)
    db.flush()

    client.post(
        "/api/v1/products",
        json={
            "name": "Pre-order Case",
            "game_id": str(game_id),
            "product_type_id": str(product_type_id),
            "set_name": "Pre Ordered",
        },
    )

    assert "Pre Ordered" in names(client, limit=30)


def test_a_set_somebody_typed_has_no_date_and_is_always_offered(client, make_product):
    make_product("Panini Sticker", set_name="World Cup 2026")

    assert "World Cup 2026" in names(client, limit=30)


# ------------------------------------------------------------------- suggestions


def test_what_the_group_actually_buys_comes_first(client, make_product):
    """The seeded calendar is a bonus. Unmaintained it goes stale, so it never leads.

    When it ages out nothing breaks - suggestions fall back to what really gets bought.
    """
    make_product("Something Real", set_name="Actually Bought")

    assert names(client)[0] == "Actually Bought"


def test_suggestions_are_scoped_to_one_game(client, db):
    """"Fabled" means something in Lorcana and nothing in Pokémon."""
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    db.add(CardSet(game_id=lorcana, name="Winterspell Extra", released_on=TODAY))
    db.flush()

    assert "Winterspell Extra" not in names(client, "pokemon", limit=30)
    assert "Winterspell Extra" in names(client, "lorcana", limit=30)


def test_typing_part_of_a_name_finds_it(client, db):
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    db.add(CardSet(game_id=lorcana, name="Fabled", released_on=TODAY))
    db.flush()

    assert "Fabled" in names(client, "lorcana", q="fab")


def test_a_misspelling_still_finds_it(client):
    """Same forgiving machinery that makes product search work, pointed at set names.

    Uses a seeded set rather than a fixture one, which also proves the calendar is really
    in the database and searchable.
    """
    assert "Winterspell" in names(client, "lorcana", q="wintespell")


def test_the_list_is_capped(client):
    assert len(names(client, limit=3)) <= 3


def test_a_game_that_does_not_exist_is_a_404(client):
    assert client.get("/api/v1/sets", params={"game": "quidditch"}).status_code == 404


def test_a_suggestion_says_how_much_it_is_used(client, make_product):
    make_product("Used Twice A", set_name="Counted Set")
    make_product("Used Twice B", set_name="Counted Set")

    row = next(item for item in suggest(client)["items"] if item["name"] == "Counted Set")
    assert row["uses"] == 2
    assert row["released_on"] is None


# --------------------------------------------------------------------- duplicates


def test_the_same_set_typed_two_ways_is_one_record(client, make_product, db, game_id):
    """The entire point. Two rows here undercount every report that groups by set."""
    make_product("First", set_name="Pitch Black Night")
    make_product("Second", set_name="  pitch black night  ")

    matching = db.scalars(
        select(CardSet).where(
            CardSet.game_id == game_id, CardSet.name.ilike("pitch black night")
        )
    ).all()
    assert len(matching) == 1


def test_the_stored_name_is_the_set_s_own(client, make_product):
    """Typing "fabled" saves as "Fabled" - the record's name wins, not the keystrokes."""
    make_product("Canonical First", set_name="Canonical Name")
    second = make_product("Canonical Second", set_name="CANONICAL NAME")

    assert second["set_name"] == "Canonical Name"


def test_two_games_can_have_a_set_of_the_same_name(client, db, game_id, product_type_id):
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    for game in (game_id, lorcana):
        response = client.post(
            "/api/v1/products",
            json={
                "name": f"Shared Name {game}",
                "game_id": str(game),
                "product_type_id": str(product_type_id),
                "set_name": "Shared Set Name",
            },
        )
        assert response.status_code == 201

    matching = db.scalars(
        select(CardSet).where(CardSet.name == "Shared Set Name")
    ).all()
    assert len(matching) == 2


def test_a_near_miss_is_questioned(client, db):
    """"Did you mean Fabled?" before the duplicate exists, not a rollup that undercounts."""
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    db.add(CardSet(game_id=lorcana, name="Fabled", released_on=TODAY))
    db.flush()

    assert suggest(client, "lorcana", q="Fable")["did_you_mean"] == "Fabled"


def test_an_exact_name_is_not_questioned(client, db):
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    db.add(CardSet(game_id=lorcana, name="Fabled", released_on=TODAY))
    db.flush()

    assert suggest(client, "lorcana", q="fabled")["did_you_mean"] is None


def test_something_unrelated_is_not_questioned(client):
    """Nothing is blocked, and nothing is put in somebody's mouth on a weak match."""
    assert suggest(client, q="Completely Different Thing")["did_you_mean"] is None


def test_no_query_asks_nothing(client):
    assert suggest(client)["did_you_mean"] is None


# ------------------------------------------------------------------ on a product


def test_a_product_carries_the_set_it_resolved_to(client, make_product):
    product = make_product("Has A Set", set_name="Resolved Set")

    assert product["set_id"] is not None
    assert product["set_name"] == "Resolved Set"


def test_a_product_can_have_no_set(client, make_product):
    assert make_product("No Set")["set_id"] is None


def test_a_blank_set_name_is_no_set(client, make_product):
    assert make_product("Blank Set", set_name="   ")["set_id"] is None


def test_changing_the_set_moves_the_link(client, make_product):
    product = make_product("Moves Set", set_name="First Set")
    first = product["set_id"]

    updated = client.patch(
        f"/api/v1/products/{product['id']}", json={"set_name": "Second Set"}
    ).json()

    assert updated["set_id"] != first
    assert updated["set_name"] == "Second Set"


def test_clearing_the_set_clears_the_link(client, make_product):
    product = make_product("Clears Set", set_name="Some Set")

    updated = client.patch(
        f"/api/v1/products/{product['id']}", json={"set_name": None}
    ).json()

    assert updated["set_id"] is None
    assert updated["set_name"] is None


def test_the_set_still_turns_up_in_product_search(client, make_product):
    """`search_text` is a generated column, so the set name has to stay on the row."""
    make_product("Searchable By Set", set_name="Distinctive Setname")

    found = client.get("/api/v1/products", params={"q": "Distinctive Setname"}).json()
    assert "Searchable By Set" in [item["name"] for item in found["items"]]


def test_moving_a_product_to_another_game_rehomes_its_set(client, make_product, db):
    """A set belongs to a game, so following the product is the only coherent answer."""
    lorcana = db.scalar(select(Game.id).where(Game.slug == "lorcana"))
    product = make_product("Changes Game", set_name="Travelling Set")

    updated = client.patch(
        f"/api/v1/products/{product['id']}",
        json={"game_id": str(lorcana), "set_name": "Travelling Set"},
    ).json()

    moved = db.get(CardSet, __import__("uuid").UUID(updated["set_id"]))
    assert moved.game_id == lorcana


# ------------------------------------------------------------------- the service


def test_resolving_a_blank_name_makes_nothing(db, game_id):
    assert sets.resolve(db, game_id=game_id, name="   ", member_id=None) is None
