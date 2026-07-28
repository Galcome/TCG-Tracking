"""Member routes."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.member import Member
from src.schemas.member import MemberRead

router = APIRouter()


@router.get("/me", response_model=MemberRead)
def read_me(member: Member = Depends(get_current_member)) -> Member:
    """The signed-in member. Also the endpoint that provisions them on first sign-in."""
    return member


@router.get("", response_model=list[MemberRead])
def list_members(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[Member]:
    """Everyone who can operate the store. Used to populate "sold by" pickers."""
    return list(db.scalars(select(Member).order_by(Member.display_name, Member.id)))
