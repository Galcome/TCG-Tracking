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

#: Read the upload in pieces so an oversized body is refused while it is still
#: arriving. `await photo.read()` would materialise the whole thing first, which
#: lets any signed-in member spend the process's memory before the size check runs.
CHUNK_BYTES = 64 * 1024


async def _read_within_limit(photo: UploadFile) -> bytes:
    """The photo's bytes, or a 413 as soon as it is one byte past the ceiling."""
    chunks: list[bytes] = []
    total = 0
    while chunk := await photo.read(CHUNK_BYTES):
        total += len(chunk)
        if total > vision.MAX_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="That photo is too large. Try a smaller one.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


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

    image = await _read_within_limit(photo)

    try:
        found = vision.read_cards(image, photo.content_type)
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
