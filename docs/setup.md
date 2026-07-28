# Setup Guide

## Prerequisites

| Tool | Install |
|------|---------|
| Python 3.11+ | https://python.org |
| uv | `pip install uv` |
| Docker Desktop | https://docker.com/products/docker-desktop |
| Git | https://git-scm.com |

## Step-by-Step

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd production-projects
```

### 2. Install dependencies

`uv` creates the virtual environment and installs everything from `pyproject.toml` automatically.

```bash
uv sync
```

### 3. Configure environment variables

```bash
copy .env.example .env    # Windows
```

Open `.env` and set:
- `SECRET_KEY` — generate one with:
  ```bash
  uv run python -c "import secrets; print(secrets.token_hex(32))"
  ```
- `DATABASE_URL` — leave as-is if using docker-compose with the default credentials

### 4. Start Postgres

```bash
docker compose up -d
```

This starts a Postgres 16 container on port 5432 with the credentials from `docker-compose.yml`.
The data is persisted in a Docker volume so it survives restarts.

### 5. Apply migrations

```bash
make db-upgrade
```

### 6. Start the application

```bash
make run
```

## Running Tests

```bash
make test
```

## Troubleshooting

**"Field required" on startup**
→ `SECRET_KEY` or `DATABASE_URL` is missing from `.env`.

**"Cannot connect to the database"**
→ Run `docker compose up -d` and wait a few seconds for Postgres to be ready.

**Port 5432 already in use**
→ You have a local Postgres running. Either stop it or change the port in `docker-compose.yml` and `DATABASE_URL`.
