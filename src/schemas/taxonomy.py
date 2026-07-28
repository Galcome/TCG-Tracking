"""Game and product-type request and response models."""

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaxonomyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    is_system: bool
    sort_order: int


class TaxonomyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("name cannot be blank")
        return stripped
