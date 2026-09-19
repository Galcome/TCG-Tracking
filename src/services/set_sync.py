"""Sets from the TCGCSV catalog, so a new release is selectable without a migration.

The seeded calendar in 0008 was hand-written and went stale the day it shipped: some
names were wrong ("Rising Chaos" is really "Chaos Rising") and nothing ever added the next
Lorcana or One Piece set. This runs once a day, before the price refresh, and does two
things per game:

- **Links** a set we already have to its catalog group - by name first, then by a release
  date within a few days plus a similar name, which is what catches the misnamed seeds.
- **Creates** a set for a recent release nobody has yet.

Only groups with a real release date are considered. TCGCSV stamps a release as a bare
midnight date; a legacy group it republishes carries the publish instant instead
("2026-09-18T20:00:06.65Z" on POP Series 1 from 2004). Trusting the latter would announce
twenty-year-old sets as brand new. Promos, prize packs, energies and similar groups are not
sets anyone files a product under, so they are skipped rather than cluttering the picker.

A catalog failure for one game is recorded and the others carry on. Nothing here touches
products, stock or money.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from src.models.card_set import CardSet
from src.models.taxonomy import Game
from src.services.pricing import CatalogGroup, PricingError, TCGCSVProvider

#: How far back a release is still worth creating a set for. Older sets can be typed.
RELEASE_LOOKBACK_DAYS = 365

#: How far apart the catalog's date and a seeded date may be and still be the same set.
LINK_WINDOW_DAYS = 10

#: How alike the names must be for a date match to count as the same set.
LINK_SIMILARITY = 0.4

#: "ME06: Delta Reign" -> "Delta Reign". Set codes are noise in a picker.
_SET_CODE = re.compile(r"^[A-Z]{1,5}\d{0,3}(?:\.\d)?:\s+")

_NOT_A_SET = re.compile(
    r"promo|prize pack|trainer kit|miscellaneous|jumbo|energies|release event|"
    r"pre-?release|tournament cards|eternal-legal|source material|"
    r"art series|playtest|championship|league|code card",
    re.IGNORECASE,
)

_NAME_LENGTH = 120


@dataclass(frozen=True)
class SyncSummary:
    games: int
    created: int
    linked: int
    errors: tuple[str, ...]


def release_date(published_on: str | None) -> date | None:
    """The group's release date, or None when the stamp is not a release date."""
    if not published_on:
        return None
    try:
        stamp = datetime.fromisoformat(published_on)
    except ValueError:
        return None
    if stamp.time() != time(0):
        return None
    return stamp.date()


def display_name(name: str) -> str:
    return (_SET_CODE.sub("", name).strip() or name.strip())[:_NAME_LENGTH]


def sync(
    db: Session,
    *,
    provider: TCGCSVProvider | None = None,
    today: date | None = None,
) -> SyncSummary:
    """Link and create sets for every game that has a TCGCSV category."""
    provider = provider or TCGCSVProvider()
    reference = today or date.today()
    games = list(
        db.scalars(
            select(Game).where(Game.tcgcsv_category_id.is_not(None)).order_by(Game.slug)
        )
    )
    created = linked = 0
    errors: list[str] = []
    for game in games:
        try:
            groups = provider.groups(game.tcgcsv_category_id)
        except PricingError as error:
            errors.append(f"{game.slug}: {error}")
            continue
        game_created, game_linked = _sync_game(db, game, groups, reference)
        created += game_created
        linked += game_linked
    return SyncSummary(len(games), created, linked, tuple(errors))


def _sync_game(
    db: Session, game: Game, groups: list[CatalogGroup], today: date
) -> tuple[int, int]:
    known = set(
        db.scalars(
            select(CardSet.tcgcsv_group_id).where(CardSet.tcgcsv_group_id.is_not(None))
        )
    )
    earliest = today - timedelta(days=RELEASE_LOOKBACK_DAYS)
    candidates: list[tuple[CatalogGroup, date, str]] = []
    for group in groups:
        released = release_date(group.published_on)
        if (
            group.group_id in known
            or released is None
            or released < earliest
            or _NOT_A_SET.search(group.name)
        ):
            continue
        candidates.append((group, released, display_name(group.name)))
    candidates.sort(key=lambda item: (item[1], item[0].group_id))

    # Exact names first across the whole game, so "30th Celebration Classic Collection"
    # cannot claim the seeded "30th Celebration" by similarity before its real group does.
    linked = 0
    remaining = []
    for group, released, name in candidates:
        found = db.scalars(
            _unlinked(game).where(func.lower(CardSet.name) == name.lower()).limit(1)
        ).first()
        if found is None:
            remaining.append((group, released, name))
            continue
        _link(db, found, group, released, name)
        linked += 1

    created = 0
    for group, released, name in remaining:
        score = func.word_similarity(name, CardSet.name)
        found = db.scalars(
            _unlinked(game)
            .where(
                CardSet.released_on.between(
                    released - timedelta(days=LINK_WINDOW_DAYS),
                    released + timedelta(days=LINK_WINDOW_DAYS),
                ),
                score >= LINK_SIMILARITY,
            )
            .order_by(score.desc(), CardSet.name)
            .limit(1)
        ).first()
        if found is not None:
            _link(db, found, group, released, name)
            linked += 1
            continue
        inserted = db.execute(
            pg_insert(CardSet)
            .values(
                game_id=game.id,
                name=name,
                released_on=released,
                tcgcsv_group_id=group.group_id,
            )
            .on_conflict_do_nothing()
            .returning(CardSet.id)
        ).first()
        if inserted is not None:
            created += 1
    db.flush()
    return created, linked


def _unlinked(game: Game):
    return select(CardSet).where(
        CardSet.game_id == game.id, CardSet.tcgcsv_group_id.is_(None)
    )


def _link(db: Session, record: CardSet, group: CatalogGroup, released: date, name: str) -> None:
    record.tcgcsv_group_id = group.group_id
    if record.created_by_member_id is None:
        # A seeded set is our guess; the catalog is the source of truth for its name and
        # date. A set somebody typed keeps the name they chose.
        record.released_on = released
        clash = db.scalar(
            select(CardSet.id).where(
                CardSet.game_id == record.game_id,
                func.lower(CardSet.name) == name.lower(),
                CardSet.id != record.id,
            )
        )
        if clash is None:
            record.name = name
    elif record.released_on is None:
        record.released_on = released
    db.flush()
