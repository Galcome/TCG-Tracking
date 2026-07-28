"""Tests for JWT authentication."""

import os
import time
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import src.auth as auth
from src.main import app

client = TestClient(app)

# Read from environment — must match whatever SUPABASE_JWT_SECRET is set to.
# Set in conftest.py for local runs; set in ci.yml for CI runs.
_TEST_SECRET = os.environ["SUPABASE_JWT_SECRET"]


def _make_token(sub: str = "user-123", expired: bool = False) -> str:
    """Generate a signed JWT for testing."""
    payload = {
        "sub": sub,
        "email": "test@example.com",
        "aud": "authenticated",
        "exp": int(time.time()) + (-1 if expired else 3600),
    }
    return jwt.encode(payload, _TEST_SECRET, algorithm="HS256")


def test_me_returns_user_when_token_is_valid():
    token = _make_token()
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["user_id"] == "user-123"
    assert response.json()["email"] == "test@example.com"


def test_me_returns_401_when_token_is_expired():
    token = _make_token(expired=True)
    response = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"]


def test_me_returns_401_when_token_is_invalid():
    response = client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert response.status_code == 401


def test_me_returns_401_when_no_token_provided():
    response = client.get("/api/v1/me")
    assert response.status_code == 401


def test_jwks_client_is_created_from_supabase_settings():
    auth._jwks_client = None
    client = auth._get_jwks_client()
    assert "https://test.supabase.co/auth/v1/.well-known/jwks.json" in client.uri


def test_asymmetric_token_uses_supabase_jwks():
    token = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2ln"

    class FakeJwksClient:
        def get_signing_key_from_jwt(self, received_token: str):
            assert received_token == token
            return SimpleNamespace(key="public-key")

    with (
        patch("src.auth._get_jwks_client", return_value=FakeJwksClient()),
        patch("src.auth.jwt.decode", return_value={"sub": "user-123"}) as decode,
    ):
        assert auth._verify_token(token) == {"sub": "user-123"}

    assert "ES256" in decode.call_args.kwargs["algorithms"]


def test_asymmetric_token_returns_401_when_jwks_unavailable():
    token = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2ln"

    class FakeJwksClient:
        def get_signing_key_from_jwt(self, received_token: str):
            raise jwt.PyJWKClientError("jwks unavailable")

    with patch("src.auth._get_jwks_client", return_value=FakeJwksClient()):
        with pytest.raises(HTTPException) as exc:
            auth._verify_token(token)

    assert exc.value.status_code == 401
    assert exc.value.detail == "Authentication key unavailable"
