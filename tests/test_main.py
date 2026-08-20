"""Tests for the FastAPI application."""

from unittest.mock import patch

from fastapi.testclient import TestClient

from src.main import SLOW_REQUEST_THRESHOLD_MS, app, create_app

client = TestClient(app)


def test_health_returns_ok_when_db_connected():
    with patch("src.main.check_connection", return_value=True):
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_returns_503_when_db_unreachable():
    with patch("src.main.check_connection", return_value=False):
        response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "error"


def test_security_headers_added_to_responses():
    with patch("src.main.check_connection", return_value=True):
        response = client.get("/health", headers={"X-Request-ID": "test-request-123"})
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Cross-Origin-Opener-Policy"] == "same-origin"
    assert response.headers["Cross-Origin-Resource-Policy"] == "same-origin"
    assert response.headers["X-Request-ID"] == "test-request-123"
    assert "X-Process-Time-Ms" in response.headers


def test_invalid_request_id_is_replaced():
    with patch("src.main.check_connection", return_value=True):
        response = client.get("/health", headers={"X-Request-ID": "bad request id"})
    assert response.headers["X-Request-ID"].startswith("api-")


def test_create_app_disables_docs_in_production():
    with patch("src.main.settings.app_env", "production"):
        prod_app = create_app()
    assert prod_app.docs_url is None
    assert prod_app.redoc_url is None
    assert prod_app.openapi_url is None


def test_production_responses_include_hsts():
    with (
        patch("src.main.settings.app_env", "production"),
        patch("src.main.check_connection", return_value=True),
    ):
        prod_client = TestClient(create_app())
        response = prod_client.get("/health")

    assert response.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"


def test_slow_requests_are_logged():
    with (
        patch("src.main.check_connection", return_value=True),
        # Derived from the threshold rather than hardcoded, so raising the threshold
        # cannot leave this test silently asserting nothing.
        patch("src.main.perf_counter", side_effect=[0.0, SLOW_REQUEST_THRESHOLD_MS / 1000 + 1]),
        patch("src.main.logger.warning") as warning,
    ):
        response = client.get("/health")

    assert response.status_code == 200
    warning.assert_called_once()


def test_lifespan_startup_and_shutdown():
    with patch("src.main.check_connection", return_value=True):
        with TestClient(app) as c:
            response = c.get("/health")
    assert response.status_code == 200
