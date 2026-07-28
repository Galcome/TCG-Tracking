"""Product request and response models."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from src.schemas.taxonomy import TaxonomyRead

NAME_MAX_LENGTH = 200

# Fields on ProductUpdate that back NOT NULL columns. Omitting them leaves the value
# alone; sending an explicit null is invalid input, not a request to clear them.
NON_NULLABLE_UPDATE_FIELDS = ("name", "game_id", "product_type_id", "is_archived")


class ProductBase(BaseModel):
    set_name: str | None = Field(default=None, max_length=120)
    collector_number: str | None = Field(default=None, max_length=40)
    variant: str | None = Field(default=None, max_length=80)
    language: str | None = Field(default=None, max_length=40)
    condition: str | None = Field(default=None, max_length=40)
    grading_company: str | None = Field(default=None, max_length=40)
    grade: str | None = Field(default=None, max_length=20)
    cert_number: str | None = Field(default=None, max_length=40)
    external_ref: str | None = Field(default=None, max_length=120)
    image_url: str | None = Field(default=None, max_length=500)
    storage_location: str | None = Field(default=None, max_length=120)
    notes: str | None = None

    @field_validator(
        "set_name",
        "collector_number",
        "variant",
        "language",
        "condition",
        "grading_company",
        "grade",
        "cert_number",
        "external_ref",
        "image_url",
        "storage_location",
        "notes",
        mode="after",
    )
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        """Treat whitespace-only optional input as absent rather than storing it."""
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class ProductCreate(ProductBase):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    game_id: uuid.UUID
    product_type_id: uuid.UUID

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped


class ProductUpdate(ProductBase):
    """Every field optional - only what is sent gets changed.

    `None` here means "not supplied". Sending an explicit null for a field backing a
    NOT NULL column is rejected as invalid input rather than allowed through to fail
    as a 500.
    """

    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX_LENGTH)
    game_id: uuid.UUID | None = None
    product_type_id: uuid.UUID | None = None
    is_archived: bool | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped

    @model_validator(mode="after")
    def reject_explicit_nulls(self) -> "ProductUpdate":
        for field in NON_NULLABLE_UPDATE_FIELDS:
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    game: TaxonomyRead
    product_type: TaxonomyRead
    is_archived: bool
    created_by_member_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class ProductList(BaseModel):
    """Explicit envelope so pagination never has to be inferred from the array."""

    items: list[ProductRead]
    total: int
    limit: int
    offset: int
