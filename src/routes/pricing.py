"""Authenticated operations for free catalog mappings and market quotes."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.dependencies import db_session, get_current_member
from src.models.catalog import (
    CATALOG_PROVIDER_TCGCSV,
    CATALOG_PROVIDERS,
    CatalogMapping,
)
from src.models.member import Member
from src.models.product import Product
from src.schemas.pricing import (
    CatalogMappingCreate,
    CatalogMappingRead,
    CatalogMappingUpdate,
    PricingRefreshRead,
)
from src.services import pricing as pricing_service

router = APIRouter()

MAX_MAPPINGS = 200


def _mapping_values(payload: CatalogMappingCreate | CatalogMappingUpdate) -> dict:
    # Creation needs declared defaults (`provider`, `Normal`, and `confirmed`) so the
    # ORM row satisfies its non-null columns. Updates remain patch semantics.
    return payload.model_dump(exclude_unset=not isinstance(payload, CatalogMappingCreate))


def _validate_mapping(values: dict, product: Product) -> None:
    """Reject unsupported products before any mapping can receive a quote."""
    if not pricing_service.is_pricing_eligible(product):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=pricing_service.eligibility_error(product),
        )

    provider = values.get("provider", CATALOG_PROVIDER_TCGCSV)
    if provider not in CATALOG_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="This pricing provider is not supported.",
        )

    # TCGCSV exposes one price file per numeric category/group, then one or more
    # subtype rows per product. Requiring every locator prevents a mapping that can
    # never be refreshed and makes the no-auto-match boundary explicit.
    if provider == CATALOG_PROVIDER_TCGCSV:
        required = (
            "external_product_id",
            "external_category_id",
            "external_group_id",
            "subtype_name",
        )
        if any(not str(values.get(field) or "").strip() for field in required):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="TCGCSV mappings require product, category, group, and subtype values.",
            )
        if values.get("match_status") not in ("confirmed", "disabled"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Mapping status must be confirmed or disabled.",
            )
        for field in ("external_product_id", "external_category_id", "external_group_id"):
            if not str(values[field]).isdigit():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=f"TCGCSV {field.replace('_', ' ')} must be numeric.",
                )


def _conflict_if_existing(db: Session, product_id: uuid.UUID, provider: str) -> None:
    if db.scalar(
        select(CatalogMapping.id).where(
            CatalogMapping.product_id == product_id,
            CatalogMapping.provider == provider,
        )
    ) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A mapping for this product and provider already exists; update it instead.",
        )


@router.get("/mappings", response_model=list[CatalogMappingRead])
def list_mappings(
    product_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=MAX_MAPPINGS),
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> list[CatalogMappingRead]:
    stmt = select(CatalogMapping).order_by(CatalogMapping.created_at.desc()).limit(limit)
    if product_id is not None:
        stmt = stmt.where(CatalogMapping.product_id == product_id)
    return [
        CatalogMappingRead.model_validate(row, from_attributes=True)
        for row in db.scalars(stmt).all()
    ]


@router.post(
    "/mappings",
    response_model=CatalogMappingRead,
    status_code=status.HTTP_201_CREATED,
)
def create_mapping(
    payload: CatalogMappingCreate,
    member: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> CatalogMappingRead:
    product = db.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    values = _mapping_values(payload)
    _validate_mapping(values, product)
    _conflict_if_existing(db, product.id, payload.provider)

    mapping = CatalogMapping(
        **{key: value for key, value in values.items() if key != "product_id"},
        product_id=product.id,
        created_by_member_id=member.id,
    )
    db.add(mapping)
    try:
        db.flush()
    except IntegrityError as error:
        # A second operator may have created the same provider mapping after the
        # read above. Keep the response stable instead of returning a 500.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A mapping for this product and provider already exists; update it instead.",
        ) from error
    db.refresh(mapping)
    return CatalogMappingRead.model_validate(mapping, from_attributes=True)


@router.patch("/mappings/{mapping_id}", response_model=CatalogMappingRead)
def update_mapping(
    mapping_id: uuid.UUID,
    payload: CatalogMappingUpdate,
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> CatalogMappingRead:
    mapping = db.get(CatalogMapping, mapping_id)
    if mapping is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping not found")

    changes = _mapping_values(payload)
    candidate = {
        "provider": mapping.provider,
        "external_product_id": mapping.external_product_id,
        "external_group_id": mapping.external_group_id,
        "external_category_id": mapping.external_category_id,
        "subtype_name": mapping.subtype_name,
        "condition": mapping.condition,
        "language": mapping.language,
        "match_status": mapping.match_status,
        "notes": mapping.notes,
        **changes,
    }
    _validate_mapping(candidate, mapping.product)
    for field, value in changes.items():
        setattr(mapping, field, value)

    db.flush()
    db.refresh(mapping)
    return CatalogMappingRead.model_validate(mapping, from_attributes=True)


@router.post("/refresh", response_model=PricingRefreshRead)
def refresh_pricing(
    _: Member = Depends(get_current_member),
    db: Session = Depends(db_session),
) -> PricingRefreshRead:
    """Refresh confirmed mappings once; a later scheduler can call this same operation."""
    try:
        summary = pricing_service.refresh(db)
    except pricing_service.PricingRefreshBusy as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    except pricing_service.PricingRefreshLimitExceeded as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except pricing_service.PricingError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    return PricingRefreshRead(
        attempted=summary.attempted,
        refreshed=summary.refreshed,
        skipped=summary.skipped,
        stale=summary.stale,
        unavailable=summary.unavailable,
        source_revision=summary.source_revision,
        errors=list(summary.errors),
    )
