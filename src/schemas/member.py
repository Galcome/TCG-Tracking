"""Member request and response models."""

import uuid

from pydantic import BaseModel, ConfigDict


class MemberRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    role: str
    is_active: bool
