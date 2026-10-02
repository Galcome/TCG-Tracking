"""Game and product-type routes.

Both tables have the same shape and the same rules, so one factory builds both
routers rather than duplicating six near-identical handlers.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.database import Base
from src.dependencies import db_session, get_current_member
from src.models.member import Member
from src.models.taxonomy import DEFAULT_SORT_ORDER, Game, ProductType
from src.schemas.taxonomy import TaxonomyCreate, TaxonomyRead
from src.services.slug import slugify


def build_router(model: type[Base], label: str) -> APIRouter:
    router = APIRouter()

    @router.get("", response_model=list[TaxonomyRead])
    def list_all(
        _: Member = Depends(get_current_member),
        db: Session = Depends(db_session, scope="function"),
    ) -> list[Base]:
        return list(db.scalars(select(model).order_by(model.sort_order, model.name)))

    @router.post("", response_model=TaxonomyRead, status_code=status.HTTP_201_CREATED)
    def create(
        payload: TaxonomyCreate,
        _: Member = Depends(get_current_member),
        db: Session = Depends(db_session, scope="function"),
    ) -> Base:
        slug = slugify(payload.name)
        if not slug:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{label} name must contain at least one letter or number",
            )

        existing = db.scalar(select(model).where(model.slug == slug))
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{label} '{existing.name}' already exists",
            )

        record = model(
            name=payload.name,
            slug=slug,
            is_system=False,
            sort_order=DEFAULT_SORT_ORDER,
        )
        db.add(record)
        db.flush()
        return record

    @router.patch("/{record_id}", response_model=TaxonomyRead)
    def rename(
        record_id: uuid.UUID,
        payload: TaxonomyCreate,
        _: Member = Depends(get_current_member),
        db: Session = Depends(db_session, scope="function"),
    ) -> Base:
        """Rename it. The slug stays, because rules and saved links are keyed on it."""
        record = db.get(model, record_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found"
            )

        slug = slugify(payload.name)
        if not slug:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{label} name must contain at least one letter or number",
            )

        # Another row already answering to this name, by either spelling of it.
        clash = db.scalar(
            select(model).where(
                model.id != record.id,
                (model.slug == slug) | (func.lower(model.name) == payload.name.lower()),
            )
        )
        if clash is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{label} '{clash.name}' already exists",
            )

        record.name = payload.name
        db.flush()
        return record

    return router


games_router = build_router(Game, "Game")
product_types_router = build_router(ProductType, "Product type")
