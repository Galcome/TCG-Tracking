"""Tests for Firebase ID token verification.

Real RS256 tokens are signed with a throwaway key generated here, and the JWKS
lookup is stubbed to return its public half. That exercises the actual signature,
audience, issuer and expiry checks rather than mocking jwt.decode away.
"""

import time
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

import src.auth as auth
from src.config import settings

_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PUBLIC_KEY = _PRIVATE_KEY.public_key()


def make_token(**overrides) -> str:
    now = int(time.time())
    payload = {
        "sub": "firebase-uid-123",
        "email": "patrick@example.com",
        "aud": settings.firebase_project_id,
        "iss": settings.firebase_issuer,
        "iat": now,
        "exp": now + 3600,
        **overrides,
    }
    return jwt.encode(payload, _PRIVATE_KEY, algorithm="RS256")


class FakeJwksClient:
    def get_signing_key_from_jwt(self, _token: str):
        return SimpleNamespace(key=_PUBLIC_KEY)


@pytest.fixture
def signing_key():
    with patch("src.auth._get_jwks_client", return_value=FakeJwksClient()):
        yield


def test_valid_token_returns_claims(signing_key):
    claims = auth._verify_token(make_token())
    assert claims["sub"] == "firebase-uid-123"
    assert claims["email"] == "patrick@example.com"


def test_expired_token_is_rejected(signing_key):
    now = int(time.time())
    with pytest.raises(HTTPException) as exc:
        auth._verify_token(make_token(iat=now - 7200, exp=now - 3600))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Token has expired"


def test_token_for_another_firebase_project_is_rejected(signing_key):
    with pytest.raises(HTTPException) as exc:
        auth._verify_token(make_token(aud="someone-elses-project"))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_token_from_an_unexpected_issuer_is_rejected(signing_key):
    with pytest.raises(HTTPException) as exc:
        auth._verify_token(make_token(iss="https://evil.example/"))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_token_without_a_subject_claim_is_rejected(signing_key):
    token = jwt.encode(
        {
            "aud": settings.firebase_project_id,
            "iss": settings.firebase_issuer,
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        },
        _PRIVATE_KEY,
        algorithm="RS256",
    )
    with pytest.raises(HTTPException) as exc:
        auth._verify_token(token)
    assert exc.value.status_code == 401


def test_token_with_an_empty_subject_is_rejected(signing_key):
    """An empty UID would collapse every caller onto a single member row."""
    with pytest.raises(HTTPException) as exc:
        auth._verify_token(make_token(sub=""))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_garbage_token_is_rejected(signing_key):
    with pytest.raises(HTTPException) as exc:
        auth._verify_token("not-a-real-token")
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_unavailable_signing_keys_are_reported_separately():
    class BrokenJwksClient:
        def get_signing_key_from_jwt(self, _token: str):
            raise jwt.PyJWKClientError("jwks unavailable")

    with patch("src.auth._get_jwks_client", return_value=BrokenJwksClient()):
        with pytest.raises(HTTPException) as exc:
            auth._verify_token(make_token())

    assert exc.value.status_code == 401
    assert exc.value.detail == "Authentication key unavailable"


def test_jwks_client_targets_googles_securetoken_keys():
    auth._jwks_client = None
    try:
        client = auth._get_jwks_client()
        assert client.uri == auth.FIREBASE_JWKS_URL
        assert auth._get_jwks_client() is client, "client should be cached, not rebuilt"
    finally:
        auth._jwks_client = None


def test_get_current_user_verifies_the_bearer_credentials(signing_key):
    credentials = SimpleNamespace(scheme="Bearer", credentials=make_token())
    assert auth.get_current_user(credentials)["sub"] == "firebase-uid-123"
