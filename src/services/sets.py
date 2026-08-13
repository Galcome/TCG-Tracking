"""Sets: resolving a typed name to a record, and suggesting the right ones.

Two sources feed one ranked list. What the group has **actually bought**, most recently
first, is primary. The **seeded release calendar** is a bonus layered on top, so a brand-new
set is one tap before anyone has bought it.

That order is deliberate. A seeded calendar goes stale; unmaintained, in six months it
confidently names the wrong latest set, which is worse than having none. With used sets
leading, the day the calendar ages out nothing breaks - suggestions simply fall back to what
the group really buys, and no maintenance chore has been created.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from src.models.card_set import CardSet
from src.models.product import Product
from src.services.search import escape_like

#: How forgiving the fuzzy match is when filtering. Same scale as product search.
SIMILARITY_THRESHOLD = 0.3

#: How close a typed name has to be before it is worth asking "did you mean...?".
#: Higher than the filter threshold on purpose: a suggestion that is merely plausible is
#: fine in a list, but putting a wrong name in somebody's mouth needs more confidence.
DID_YOU_MEAN_THRESHOLD = 0.55

DEFAULT_SUGGESTION_LIMIT = 8


def resolve(
    db: Session,
    *,
    game_id: uuid.UUID,
    name: str,
    member_id: uuid.UUID | None,
) -> CardSet | None:
    """Turn a typed set name into a record, creating it the first time it is used.

    Case-insensitive, so "fabled" lands on the existing "Fabled" rather than making a
    second row that splits every report grouping by set. A blank name is not a set.
    """
    cleaned = name.strip()
    if not cleaned:
        return None

    db.execute(
        pg_insert(CardSet)
        .values(
            id=uuid.uuid4(),
            game_id=game_id,
            name=cleaned,
            created_by_member_id=member_id,
        )
        .on_conflict_do_nothing(index_elements=[CardSet.game_id, func.lower(CardSet.name)])
    )
    db.flush()
    return db.scalars(
        select(CardSet).where(
            CardSet.game_id == game_id, func.lower(CardSet.name) == cleaned.lower()
        )
    ).one()


def suggestions(
    db: Session,
    *,
    game_id: uuid.UUID,
    query: str = "",
    limit: int = DEFAULT_SUGGESTION_LIMIT,
    today: date | None = None,
) -> list[tuple[CardSet, int]]:
    """Sets worth offering for this game, best first, with how many products use each.

    A set is offered when it has been released, or when something already uses it. That
    second clause is what makes pre-orders work: a case bought before release day links to
    the seeded set, and the set stops hiding the moment it is real to somebody.
    """
    when = today or date.today()
    search = query.strip()

    uses = func.count(Product.id)
    last_used = func.max(Product.created_at)

    statement = (
        select(CardSet, uses)
        .outerjoin(Product, Product.set_id == CardSet.id)
        .where(
            CardSet.game_id == game_id,
            (CardSet.released_on.is_(None))
            | (CardSet.released_on <= when)
            | (Product.id.is_not(None)),
        )
        .group_by(CardSet.id)
    )

    if search:
        pattern = f"%{escape_like(search)}%"
        statement = statement.where(
            CardSet.name.ilike(pattern, escape="\\")
            | (func.word_similarity(search, CardSet.name) >= SIMILARITY_THRESHOLD)
        )

    # Used sets lead, most recent first; the calendar fills whatever is left, newest
    # release first. `nullslast` on the aggregate is what puts never-used sets below.
    statement = statement.order_by(
        last_used.desc().nullslast(),
        CardSet.released_on.desc().nullslast(),
        CardSet.name,
    ).limit(limit)

    return [(record, int(count)) for record, count in db.execute(statement)]


def did_you_mean(
    db: Session, *, game_id: uuid.UUID, query: str
) -> str | None:
    """The set this was probably meant to be, when it is not one already.

    "Fable", "Fabled" and "Lorcana Fable" as three separate sets is the failure this
    exists to prevent: a rollup then splits across three rows and undercounts all of them.
    Nothing is blocked - the answer is a question, asked before the duplicate is created.
    """
    search = query.strip()
    if not search:
        return None

    exact = db.scalar(
        select(CardSet.id).where(
            CardSet.game_id == game_id, func.lower(CardSet.name) == search.lower()
        )
    )
    if exact is not None:
        return None

    score = func.word_similarity(search, CardSet.name)
    return db.scalar(
        select(CardSet.name)
        .where(CardSet.game_id == game_id, score >= DID_YOU_MEAN_THRESHOLD)
        .order_by(score.desc(), CardSet.name)
        .limit(1)
    )
