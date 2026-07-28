"""Shared FastAPI dependencies: database sessions and the current member."""

import logging
from collections.abc import Generator

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.auth import get_current_user
from src.config import settings
from src.database import get_db
from src.models.member import ROLE_ADMIN, ROLE_MEMBER, Member

logger = logging.getLogger(__name__)

DISPLAY_NAME_MAX_LENGTH = 100
FALLBACK_DISPLAY_NAME = "Member"


def db_session() -> Generator[Session, None, None]:
    """Request-scoped session. Commits on success, rolls back on error."""
    with get_db() as session:
        yield session


def _display_name_from_claims(claims: dict) -> str:
    name = (claims.get("name") or "").strip()
    if name:
        return name[:DISPLAY_NAME_MAX_LENGTH]
    email = (claims.get("email") or "").strip()
    if email:
        return email.split("@", 1)[0][:DISPLAY_NAME_MAX_LENGTH]
    return FALLBACK_DISPLAY_NAME


def get_current_member(
    claims: dict = Depends(get_current_user),
    db: Session = Depends(db_session),
) -> Member:
    """Resolve the verified Firebase token to a member row, creating one on first sign-in.

    Holding an account in the store's Firebase project *is* the access grant - the
    Firebase console is the invite mechanism, so there is no separate approval step.
    The first member to ever sign in becomes the admin; everyone after defaults to
    member and an existing admin promotes them.
    """
    email = (claims.get("email") or "").strip().lower()
    allowlist = settings.member_email_allowlist
    if allowlist and email not in allowlist:
        # A valid Firebase token proves who you are, not that you belong here. With
        # Google sign-in enabled, anyone can get one. Fail closed, including when the
        # token carries no email at all.
        raise HTTPException(status_code=403, detail="This account is not a member of this store")

    auth_user_id = claims["sub"]
    member = db.scalar(select(Member).where(Member.auth_user_id == auth_user_id))

    if member is None:
        is_first_member = db.scalar(select(func.count()).select_from(Member)) == 0
        member = Member(
            auth_user_id=auth_user_id,
            email=email or None,
            display_name=_display_name_from_claims(claims),
            role=ROLE_ADMIN if is_first_member else ROLE_MEMBER,
        )
        db.add(member)
        try:
            db.flush()
        except IntegrityError:
            # Two first requests raced. The unique constraint on auth_user_id decided
            # the winner; adopt whichever row landed.
            db.rollback()
            member = db.scalar(select(Member).where(Member.auth_user_id == auth_user_id))
            if member is None:
                raise HTTPException(status_code=500, detail="Could not resolve member")

    if not member.is_active:
        raise HTTPException(status_code=403, detail="This account has been deactivated")

    return member
