"""Set suggestions.

Read-only. Sets are created by using them - typing a new name on a product - so there is no
POST here and no admin screen to keep up to date. Nobody should be blocked at 11pm because
a set is missing.
"""

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.card_set import CardSet
from src.models.member import Member
from src.models.product import Product
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
    db: Session = Depends(db_session, scope="function"),
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


class SetRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped


@router.patch("/{set_id}", response_model=SetRead)
def rename_set(
    set_id: uuid.UUID,
    payload: SetRename,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session, scope="function"),
) -> SetRead:
    """Rename a set everywhere it is used.

    The set is a record, so this is one row - plus the copy of the name each product
    carries for search, which has to follow or the old spelling keeps finding them.
    """
    record = db.get(CardSet, set_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Set not found")

    clash = db.scalar(
        select(CardSet.name).where(
            CardSet.id != record.id,
            CardSet.game_id == record.game_id,
            func.lower(CardSet.name) == payload.name.lower(),
        )
    )
    if clash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Set '{clash}' already exists"
        )

    record.name = payload.name
    db.execute(update(Product).where(Product.set_id == record.id).values(set_name=payload.name))
    db.flush()

    uses = db.scalar(select(func.count()).select_from(Product).where(Product.set_id == record.id))
    return SetRead(
        id=record.id,
        game_id=record.game_id,
        name=record.name,
        released_on=record.released_on,
        uses=int(uses or 0),
    )
