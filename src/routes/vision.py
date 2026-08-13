"""Reading card names off a photo.

One endpoint, and it writes nothing. It returns what a model thinks it saw so a form can be
prefilled; a person still presses save. An AI-read card name is a suggestion somebody
confirmed, never a fact the system minted.
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from src.dependencies import get_current_member
from src.models.member import Member
from src.services import vision

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}


class ReadCardOut(BaseModel):
    """One card. Empty strings mean the model would not say, which is the honest answer."""

    name: str
    set_name: str
    variant: str


class ReadResult(BaseModel):
    #: Whether reading photos is switched on at all, so the client can hide the button
    #: rather than offering something that always fails.
    available: bool
    cards: list[ReadCardOut]


@router.get("/status", response_model=ReadResult)
def vision_status(_: Member = Depends(get_current_member)) -> ReadResult:
    """Whether a key is configured. No key means the feature simply is not offered."""
    return ReadResult(available=vision.is_configured(), cards=[])


@router.post("/cards", response_model=ReadResult)
async def read_cards(
    photo: UploadFile = File(...),
    _: Member = Depends(get_current_member),
) -> ReadResult:
    """What cards are in this photo.

    Returns names, sets and variants to prefill the rip screen's hit rows. Anything the
    model is unsure of comes back blank rather than guessed - a wrong card name mints a
    phantom product that then splits every report.

    Never asked for value, condition or rarity. That is judgement, and it is not what this
    is for.
    """
    if photo.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That is not an image this can read.",
        )

    try:
        found = vision.read_cards(await photo.read(), photo.content_type)
    except vision.VisionUnavailable as unavailable:
        # 503 rather than 500: nothing is broken, the accelerator is just not there, and
        # the client falls back to typing.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(unavailable)
        ) from unavailable

    return ReadResult(
        available=True,
        cards=[
            ReadCardOut(name=card.name, set_name=card.set_name, variant=card.variant)
            for card in found
        ],
    )
