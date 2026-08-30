"""Application entry point - FastAPI app."""

import logging
import re
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.config import settings
from src.database import check_connection
from src.routes.api_v1 import router as api_v1_router
from src.services.vision import MAX_IMAGE_BYTES

logger = logging.getLogger(__name__)
SLOW_REQUEST_THRESHOLD_MS = 750.0
REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")

#: The one route that accepts a file. Everything else posts small JSON.
UPLOAD_PATH = "/api/v1/vision/cards"

#: Multipart wraps the file in boundaries and headers, so the request is always a
#: little larger than the photo. The slack keeps an honest 6 MiB upload from being
#: refused here; the exact per-file limit stays in the route, where the file itself
#: can be measured.
MULTIPART_OVERHEAD_BYTES = 64 * 1024
MAX_UPLOAD_BYTES = MAX_IMAGE_BYTES + MULTIPART_OVERHEAD_BYTES


async def _send_upload_too_large(send) -> None:
    """Send the upload-size response without allowing the request body to be parsed."""
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json")],
        }
    )
    await send(
        {
            "type": "http.response.body",
            "body": b'{"detail":"That photo is too large. Try a smaller one."}',
        }
    )


class UploadSizeLimitMiddleware:
    """Cap the complete upload body before Starlette parses multipart form data.

    ``Content-Length`` is only an early rejection hint. It can be absent for chunked
    requests or deliberately falsified, so the receive wrapper counts every body chunk and
    aborts as soon as the complete multipart body exceeds the ingress cap. The route still
    measures the image itself for defence in depth.
    """

    def __init__(self, app, *, upload_path: str, max_body_bytes: int):
        self.app = app
        self.upload_path = upload_path
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") != self.upload_path:
            await self.app(scope, receive, send)
            return

        declared: int | None = None
        for name, value in scope.get("headers", ()):
            if name.lower() != b"content-length":
                continue
            try:
                declared = int(value)
            except (TypeError, ValueError):
                # A malformed declaration cannot weaken the receive-side cap.
                declared = None
            break

        if declared is not None and declared > self.max_body_bytes:
            await _send_upload_too_large(send)
            return

        received = 0
        rejected = False

        async def limited_receive():
            nonlocal received, rejected
            if rejected:
                # The parser may ask for another message after the response has already
                # been sent. A disconnect lets it unwind without reading more bytes.
                return {"type": "http.disconnect"}
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    rejected = True
                    # FastAPI's multipart parser translates exceptions from `receive` to a
                    # generic 400. Send the precise 413 before returning a disconnect, and
                    # suppress the parser's follow-up response below.
                    await _send_upload_too_large(send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if not rejected:
                await send(message)

        await self.app(scope, limited_receive, guarded_send)


if settings.sentry_dsn:  # pragma: no cover
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        send_default_pii=False,
        traces_sample_rate=0.2,
    )


def _request_id_from_headers(request: Request) -> str:
    incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
    if incoming and REQUEST_ID_PATTERN.fullmatch(incoming):
        return incoming
    return f"api-{uuid4().hex[:16]}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    logger.info("Starting [env=%s role=%s]", settings.app_env, settings.app_role)
    yield
    logger.info("Shutdown complete.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="TCG Card Investments",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    app.add_middleware(
        UploadSizeLimitMiddleware,
        upload_path=UPLOAD_PATH,
        max_body_bytes=MAX_UPLOAD_BYTES,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Accept",
            "baggage",
            "sentry-trace",
            "X-Request-ID",
        ],
    )

    app.include_router(api_v1_router)

    @app.middleware("http")
    async def add_security_headers(request: Request, call_next):
        started_at = perf_counter()
        request_id = _request_id_from_headers(request)
        sentry_sdk.set_tag("request_id", request_id)
        sentry_sdk.set_tag("http.method", request.method)
        sentry_sdk.set_tag("http.route", request.url.path)
        response = await call_next(request)
        duration_ms = (perf_counter() - started_at) * 1000
        response.headers[REQUEST_ID_HEADER] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Process-Time-Ms"] = f"{duration_ms:.2f}"
        if duration_ms >= SLOW_REQUEST_THRESHOLD_MS:
            logger.warning(
                "Slow request: method=%s path=%s status=%s duration_ms=%.2f",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
                extra={"request_id": request_id},
            )
        return response

    @app.get("/health", tags=["infra"])
    def health():
        """Health check - polled by Railway and load balancers."""
        if not check_connection():
            return JSONResponse(
                status_code=503,
                content={"status": "error", "detail": "database unreachable"},
            )
        return {"status": "ok"}

    return app


app = create_app()
