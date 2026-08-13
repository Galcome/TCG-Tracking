"""Set suggestions.

Read-only. Sets are created by using them - typing a new name on a product - so there is no
POST here and no admin screen to keep up to date. Nobody should be blocked at 11pm because
a set is missing.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.member import Member
from src.models.taxonomy import Game
from src.services import sets

router = APIRouter()

MAX_SUGGESTIONS = 30


class SetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    game_id: uuid.UUID
    name: str
    #: null for a set somebody typed. A date means it came from the seeded calendar.
    released_on: date | None
    #: How many products already use it, so the UI can mark what the group actually buys.
    uses: int


class SetList(BaseModel):
    items: list[SetRead]
    #: The set this was probably meant to be, when the typed name is close to an existing
    #: one but not equal to it. A question, never a correction - nothing is blocked.
    did_you_mean: str | None


@router.get("", response_model=SetList)
def list_sets(
    game: str = Query(max_length=60, description="Game slug"),
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=sets.DEFAULT_SUGGESTION_LIMIT, ge=1, le=MAX_SUGGESTIONS),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> SetList:
    """Sets worth offering for one game, best first.

    Scoped to a game deliberately: "Fabled" means something in Lorcana and nothing in
    Pokémon, and a merged list across games is how the wrong one gets picked.
    """
    game_id = db.scalar(select(Game.id).where(Game.slug == game))
    if game_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Game not found")

    found = sets.suggestions(db, game_id=game_id, query=q, limit=limit)

    return SetList(
        items=[
            SetRead(
                id=record.id,
                game_id=record.game_id,
                name=record.name,
                released_on=record.released_on,
                uses=uses,
            )
            for record, uses in found
        ],
        did_you_mean=sets.did_you_mean(db, game_id=game_id, query=q),
    )
