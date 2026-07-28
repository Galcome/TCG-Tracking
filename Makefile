.PHONY: install run test lint format ci db-upgrade db-revision

install:
	uv sync

run:
	uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

test:
	uv run pytest tests/ -v --cov=src --cov-report=term-missing --cov-fail-under=100

lint:
	uv run ruff check src/ tests/

format:
	uv run ruff check --fix src/ tests/
	uv run ruff format src/ tests/

# Run the full CI check locally before pushing
ci: lint test

db-upgrade:
	uv run alembic upgrade head

# Usage: make db-revision message="describe your change"
db-revision:
	uv run alembic revision --autogenerate -m "$(message)"
