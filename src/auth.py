"""Authentication - Firebase ID token verification.

How it works:
    1. User signs in with the Firebase web SDK
    2. Firebase issues a short-lived RS256 ID token, signed with Google's rotating keys
    3. Client sends the token in every request: Authorization: Bearer <token>
    4. FastAPI calls get_current_user(), which verifies signature, audience and issuer
    5. The route receives the verified claims; `sub` is the Firebase UID

There is no shared secret. Verification uses Google's public JWKS, so nothing here
needs to be kept out of logs beyond the token itself.
"""

import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient, PyJWKClientError

from src.config import settings

# Google's public keys for Firebase ID tokens. Rotated roughly daily.
FIREBASE_JWKS_URL = (
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
)
_JWKS_CACHE_SECONDS = 3600
_JWKS_FETCH_TIMEOUT_SECONDS = 10

_security = HTTPBearer()
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        # Cache the key set: with NullPool there is no long-lived process state to
        # rely on, and refetching Google's JWKS on every request would be absurd.
        _jwks_client = PyJWKClient(
            FIREBASE_JWKS_URL,
            cache_jwk_set=True,
            lifespan=_JWKS_CACHE_SECONDS,
            timeout=_JWKS_FETCH_TIMEOUT_SECONDS,
        )
    return _jwks_client


def _verify_token(token: str) -> dict:
    """Verify a Firebase ID token and return its claims.

    Raises HTTPException(401) for anything that is not a currently-valid token
    issued by this project.
    """
    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.firebase_project_id,
            issuer=settings.firebase_issuer,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except PyJWKClientError:
        raise HTTPException(status_code=401, detail="Authentication key unavailable")

    # Firebase requires a non-empty `sub`; PyJWT only checks that the claim exists.
    # An empty UID would silently collapse every user onto one member row.
    if not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid token")

    return claims


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(_security),
) -> dict:
    """FastAPI dependency - verifies the Bearer token and returns the token claims."""
    return _verify_token(credentials.credentials)
