"""Members - the people who operate the store.

A member is *not* an owner of inventory. All inventory belongs to the store. A member
row exists so transactions can record who entered, purchased, or sold something.

Members are provisioned on first authenticated request (see src/dependencies.py):
holding an account in the store's Firebase project is what grants access, so the
Firebase console is the invite mechanism. `auth_user_id` stays nullable so a member
can be created for someone before they have ever signed in.
"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.mixins import TimestampMixin

ROLE_MEMBER = "member"
ROLE_ADMIN = "admin"
ROLES = (ROLE_MEMBER, ROLE_ADMIN)


class Member(Base, TimestampMixin):
    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint("role IN ('member', 'admin')", name="ck_members_role"),
        CheckConstraint("length(trim(display_name)) > 0", name="ck_members_display_name_present"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    auth_user_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_MEMBER)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
