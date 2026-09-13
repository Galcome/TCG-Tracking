"""Verify database dependency cleanup happens before an HTTP response is sent."""

import asyncio
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute

import src.dependencies as dependencies
from src.dependencies import db_session
from src.main import app


def _http_scope() -> dict:
    return {
        "type": "http",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [],
        "scheme": "http",
        "http_version": "1.1",
        "client": ("test", 1),
        "server": ("test", 80),
        "asgi": {"version": "3.0"},
    }


def _run_asgi(
    application: Callable, events: list[str]
) -> tuple[BaseException | None, list[tuple[str, int | None]]]:
    messages: Iterator[dict] = iter(
        [{"type": "http.request", "body": b"", "more_body": False}]
    )
    sent: list[tuple[str, int | None]] = []

    async def receive() -> dict:
        return next(messages, {"type": "http.disconnect"})

    async def send(message: dict) -> None:
        sent.append((message["type"], message.get("status")))
        status = message.get("status")
        suffix = f":{status}" if status is not None else ""
        events.append(f"send:{message['type']}{suffix}")

    async def request() -> None:
        await application(_http_scope(), receive, send)

    try:
        asyncio.run(request())
    except BaseException as exc:  # ServerErrorMiddleware re-raises after sending 500.
        return exc, sent
    return None, sent


def _transaction_app(
    events: list[str], *, endpoint_error: bool = False, commit_error: bool = False
) -> tuple[FastAPI, Callable]:
    @contextmanager
    def fake_get_db():
        events.append("enter")
        try:
            yield object()
            events.append("commit")
            if commit_error:
                raise RuntimeError("commit failed")
        except BaseException:
            events.append("rollback")
            raise
        finally:
            events.append("close")

    test_app = FastAPI()

    @test_app.get("/")
    def endpoint(db=Depends(db_session, scope="function")):
        del db
        events.append("endpoint")
        if endpoint_error:
            raise RuntimeError("endpoint failed")
        return {"ok": True}

    return test_app, fake_get_db


def test_db_session_commits_and_closes_before_success_response(monkeypatch):
    events: list[str] = []
    test_app, fake_get_db = _transaction_app(events)
    monkeypatch.setattr(dependencies, "get_db", fake_get_db)

    error, sent = _run_asgi(test_app, events)

    assert error is None
    assert events == [
        "enter",
        "endpoint",
        "commit",
        "close",
        "send:http.response.start:200",
        "send:http.response.body",
    ]
    assert sent == [("http.response.start", 200), ("http.response.body", None)]


def test_db_session_rolls_back_and_closes_before_endpoint_error_response(monkeypatch):
    events: list[str] = []
    test_app, fake_get_db = _transaction_app(events, endpoint_error=True)
    monkeypatch.setattr(dependencies, "get_db", fake_get_db)

    error, sent = _run_asgi(test_app, events)

    assert isinstance(error, RuntimeError)
    assert events == [
        "enter",
        "endpoint",
        "rollback",
        "close",
        "send:http.response.start:500",
        "send:http.response.body",
    ]
    assert sent == [("http.response.start", 500), ("http.response.body", None)]


def test_commit_failure_sends_500_without_a_success_response(monkeypatch):
    events: list[str] = []
    test_app, fake_get_db = _transaction_app(events, commit_error=True)
    monkeypatch.setattr(dependencies, "get_db", fake_get_db)

    error, sent = _run_asgi(test_app, events)

    assert isinstance(error, RuntimeError)
    assert events == [
        "enter",
        "endpoint",
        "commit",
        "rollback",
        "close",
        "send:http.response.start:500",
        "send:http.response.body",
    ]
    assert [status for kind, status in sent if kind == "http.response.start"] == [500]


def _iter_routes(routes):
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif hasattr(route, "original_router"):
            yield from _iter_routes(route.original_router.routes)
        elif hasattr(route, "routes"):
            yield from _iter_routes(route.routes)


def _iter_dependencies(dependant):
    for dependency in dependant.dependencies:
        yield dependency
        yield from _iter_dependencies(dependency)


def test_production_route_graph_uses_function_scoped_db_dependencies():
    db_dependencies = [
        dependency
        for route in _iter_routes(app.routes)
        for dependency in _iter_dependencies(route.dependant)
        if dependency.call is db_session
    ]

    assert db_dependencies
    assert all(dependency.scope == "function" for dependency in db_dependencies)
