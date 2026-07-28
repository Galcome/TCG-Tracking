"""API v1 router — wire all v1 route modules in here.

How to add a new feature:
    1. Create src/routes/your_feature.py with an APIRouter
    2. Import and include it below

Example:
    from src.routes.users import router as users_router
    router.include_router(users_router, prefix="/users", tags=["users"])
"""

from fastapi import APIRouter, Depends

from src.auth import get_current_user

router = APIRouter(prefix="/api/v1")


@router.get("/me", tags=["auth"])
def get_me(user: dict = Depends(get_current_user)):
    """Return the current authenticated user's ID.

    This is a placeholder route — keep it, it's useful for testing auth.
    Replace the return value with a real DB lookup when you have a users table.
    """
    return {"user_id": user["sub"], "email": user.get("email")}
