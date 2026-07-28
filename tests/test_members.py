"""Tests for member provisioning and member routes."""

import uuid
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.config import settings
from src.dependencies import db_session, get_current_member
from src.models.member import ROLE_ADMIN, ROLE_MEMBER, Member


def test_first_member_to_sign_in_becomes_the_admin(client, db):
    response = client.get("/api/v1/members/me")
    assert response.status_code == 200
    assert response.json()["role"] == ROLE_ADMIN
    assert response.json()["display_name"] == "Patrick"


def test_later_members_default_to_the_member_role(client, db, claims):
    client.get("/api/v1/members/me")  # Patrick claims admin

    claims["sub"] = "firebase-uid-jason"
    claims["name"] = "Jason"
    response = client.get("/api/v1/members/me")

    assert response.status_code == 200
    assert response.json()["role"] == ROLE_MEMBER
    assert response.json()["display_name"] == "Jason"


def test_signing_in_again_reuses_the_same_member(client, db, claims):
    first = client.get("/api/v1/members/me").json()
    second = client.get("/api/v1/members/me").json()
    assert first["id"] == second["id"]
    assert db.scalar(select(Member).where(Member.auth_user_id == claims["sub"])) is not None


def test_display_name_falls_back_to_the_email_local_part(client, claims):
    del claims["name"]
    assert client.get("/api/v1/members/me").json()["display_name"] == "patrick"


def test_display_name_falls_back_to_a_placeholder(client, claims):
    del claims["name"]
    del claims["email"]
    assert client.get("/api/v1/members/me").json()["display_name"] == "Member"


def test_blank_name_claim_falls_back_to_the_email(client, claims):
    claims["name"] = "   "
    assert client.get("/api/v1/members/me").json()["display_name"] == "patrick"


def test_deactivated_members_are_refused(client, db, claims):
    client.get("/api/v1/members/me")
    member = db.scalar(select(Member).where(Member.auth_user_id == claims["sub"]))
    member.is_active = False
    db.flush()

    response = client.get("/api/v1/members/me")
    assert response.status_code == 403
    assert response.json()["detail"] == "This account has been deactivated"


def test_list_members_returns_everyone(client, claims):
    client.get("/api/v1/members/me")
    claims["sub"] = "firebase-uid-jason"
    claims["name"] = "Jason"
    client.get("/api/v1/members/me")

    names = [member["display_name"] for member in client.get("/api/v1/members").json()]
    assert names == ["Jason", "Patrick"]


def test_concurrent_first_sign_in_adopts_the_row_that_won(db, claims):
    """Two simultaneous first requests race; the unique index decides the winner."""
    winner = Member(auth_user_id=claims["sub"], display_name="Patrick", role=ROLE_MEMBER)
    db.add(winner)
    db.flush()

    real_flush = db.flush
    calls = {"n": 0}

    def flush_once_then_conflict(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("duplicate", None, Exception("duplicate"))
        return real_flush(*args, **kwargs)

    with (
        patch.object(db, "flush", side_effect=flush_once_then_conflict),
        patch.object(db, "rollback"),
        patch.object(db, "scalar", side_effect=[None, 1, winner]),
    ):
        member = get_current_member(claims=claims, db=db)

    assert member is winner


def test_unresolvable_race_is_surfaced_rather_than_returning_none(db, claims):
    with (
        patch.object(db, "flush", side_effect=IntegrityError("dup", None, Exception("dup"))),
        patch.object(db, "rollback"),
        patch.object(db, "scalar", side_effect=[None, 0, None]),
        pytest.raises(HTTPException) as exc,
    ):
        get_current_member(claims=claims, db=db)

    assert exc.value.status_code == 500


class TestMemberAllowlist:
    """Google sign-in means a valid token proves identity, not membership."""

    def test_an_email_on_the_allowlist_is_admitted(self, client, claims):
        with patch.object(settings, "allowed_member_emails", "patrick@example.com,jason@ex.com"):
            assert client.get("/api/v1/members/me").status_code == 200

    def test_an_email_not_on_the_allowlist_is_refused(self, client, claims):
        with patch.object(settings, "allowed_member_emails", "someone-else@example.com"):
            response = client.get("/api/v1/members/me")
        assert response.status_code == 403
        assert response.json()["detail"] == "This account is not a member of this store"

    def test_the_allowlist_is_case_insensitive(self, client, claims):
        claims["email"] = "Patrick@Example.COM"
        with patch.object(settings, "allowed_member_emails", " PATRICK@example.com "):
            assert client.get("/api/v1/members/me").status_code == 200

    def test_a_token_without_an_email_fails_closed(self, client, claims):
        del claims["email"]
        with patch.object(settings, "allowed_member_emails", "patrick@example.com"):
            assert client.get("/api/v1/members/me").status_code == 403

    def test_a_refused_email_creates_no_member_row(self, client, db, claims):
        with patch.object(settings, "allowed_member_emails", "someone-else@example.com"):
            client.get("/api/v1/members/me")
        assert db.scalar(select(func.count()).select_from(Member)) == 0

    def test_removing_someone_from_the_list_revokes_existing_access(self, client, claims):
        """Editing the env var is the 'remove access' lever until an admin UI exists."""
        with patch.object(settings, "allowed_member_emails", "patrick@example.com"):
            assert client.get("/api/v1/members/me").status_code == 200
        with patch.object(settings, "allowed_member_emails", "jason@example.com"):
            assert client.get("/api/v1/members/me").status_code == 403


def test_db_session_dependency_yields_a_usable_session():
    """Covered directly because API tests override this dependency."""
    generator = db_session()
    session = next(generator)
    assert session.scalar(select(1)) == 1
    with pytest.raises(StopIteration):
        next(generator)


def test_products_require_authentication():
    """No dependency overrides here - the real HTTPBearer guard must reject."""
    from fastapi.testclient import TestClient

    from src.main import app

    response = TestClient(app).get(f"/api/v1/products/{uuid.uuid4()}")
    assert response.status_code in (401, 403)
