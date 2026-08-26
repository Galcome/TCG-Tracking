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
# Railway sleeps this service after roughly ten minutes idle and Neon suspends its compute
# alongside it, so the first request after a quiet spell spends about a second waiting on the
# database to come back. At 750ms every request in the first dashboard load tripped this and
# ten warnings arrived saying nothing except "nobody has used the app for a while". Three
# seconds is above a cold Neon resume and still below anything genuinely pathological.
SLOW_REQUEST_THRESHOLD_MS = 3000.0
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

    @app.middleware("http")
    async def limit_upload_size(request: Request, call_next):
        """Refuse an oversized upload before anything reads it.

        The route measures the photo exactly, but by the time it runs FastAPI has
        already parsed the multipart body and spooled the file to disk - so a
        check there caps memory, not ingress. Content-Length is the only thing
        available before that happens, and it is enough for the honest client the
        app actually has.

        A client that lies about the length, or streams chunked with no length at
        all, still gets through to the route's exact check. Stopping *that* costs
        a body-size limit at the proxy, which is not something the app can do to
        itself.
        """
        declared = request.headers.get("content-length", "")
        if request.url.path == UPLOAD_PATH and declared.isdigit():
            if int(declared) > MAX_UPLOAD_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"detail": "That photo is too large. Try a smaller one."},
                )
        return await call_next(request)

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
