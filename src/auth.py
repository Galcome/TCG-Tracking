"""Authentication - JWT verification via Supabase.

How it works:
    1. User logs in via Supabase client (iOS, Android, web, etc.)
    2. Supabase issues a signed JWT (asymmetric for new projects, HS256 for legacy)
    3. Client sends the JWT in every request: Authorization: Bearer <token>
    4. FastAPI calls get_current_user() which verifies the JWT
    5. Your route receives the verified user payload
"""

import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient, PyJWKClientError

from src.config import settings

_security = HTTPBearer()
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            f"{settings.supabase_url}/auth/v1/.well-known/jwks.json",
            headers={"apikey": settings.supabase_anon_key},
        )
    return _jwks_client


def _verify_token(token: str) -> dict:
    """Verify a Supabase JWT and return the decoded payload.

    Supports modern asymmetric Supabase projects and legacy HS256 projects.
    """
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
        if alg in {"RS256", "RS384", "RS512", "ES256", "ES384", "ES512"}:
            signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
                audience="authenticated",
            )
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except PyJWKClientError:
        raise HTTPException(status_code=401, detail="Authentication key unavailable")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(_security),
) -> dict:
    """FastAPI dependency - verifies the Bearer token and returns the user payload."""
    return _verify_token(credentials.credentials)
