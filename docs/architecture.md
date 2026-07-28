# Architecture

## Overview

```
.env
 │
 ▼
src/config.py  (pydantic-settings — validates types on startup)
 │
 ├──▶  src/database.py  (SQLAlchemy engine + session + Base)
 │          │
 │          ▼
 │        PostgreSQL
 │
 └──▶  src/main.py  (entry point)
```

## Layers

### `src/config.py`
Reads `.env` via pydantic-settings. Fields are type-checked on startup — if
`SECRET_KEY` is missing, the app refuses to start with a clear error rather than
failing silently later.

The `database_url` validator rewrites `postgresql://` → `postgresql+psycopg://`
automatically, so `.env` stays in standard format.

### `src/database.py`
- `engine` — SQLAlchemy connection pool (psycopg v3 driver)
- `Base` — inherit from this to define ORM models (tables)
- `get_db()` — context manager for safe session handling
- `check_connection()` — lightweight health check used on startup

### `src/main.py`
Validates settings, checks the database, then hands off to application logic.

### `migrations/`
Managed by [Alembic](https://alembic.sqlalchemy.org/).
- `env.py` — wired to our `Base.metadata` and `settings.database_url`
- `versions/` — one file per schema change, auto-generated

## Adding a New Table

1. Create `src/models/user.py` (or similar):

```python
from sqlalchemy import Column, Integer, String
from src.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)
```

2. Import the model somewhere so Alembic can see it (e.g. add to `migrations/env.py`):

```python
import src.models.user  # noqa: F401
```

3. Generate and apply the migration:

```bash
make db-revision message="add users table"
make db-upgrade
```

## Dependency Management

Dependencies live in `pyproject.toml` and are managed by `uv`.

```bash
uv add requests          # Add a runtime dependency
uv add --dev black       # Add a dev-only dependency
uv sync                  # Install / update the environment
```
