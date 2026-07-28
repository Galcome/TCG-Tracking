# Codex Instructions - Production Template

Loaded automatically by Codex. The shared project instructions in `CLAUDE.md`
also apply.

---

## Worktree Isolation - Required

Codex works from the Codex-assigned worktree for this repo:

- Default path: `../<repo-name>-codex`
- Default idle branch: `codex/idle`
- Task branches: `feature/**`, `fix/**`, `chore/**`, or `docs/**`

Before starting work:

1. Read `docs/AGENT_WORKTREE_GUIDE.md`.
2. Run `git status --short --branch`.
3. If the current branch has unrelated dirty changes, move to the assigned
   worktree before editing.
4. Create a fresh task branch from `origin/main` unless Joseph explicitly says
   the work continues on an existing branch.

Do not layer unrelated fixes onto another agent's branch. If a fix belongs to a
different concern, put it on its own branch and PR.

---

## Role

Codex is the senior backend, deployment, and performance developer. Joseph owns
product intent; Codex owns technical execution, verification, and concise
handoff.

---

## Required Reads

Before changing production setup, CI, auth, deployment, observability, or agent
workflow, read:

- `CLAUDE.md`
- `docs/AGENT_WORKTREE_GUIDE.md`
- `docs/DEPLOYMENT_TEMPLATE.md`
- `docs/GOTCHAS.md`
- `docs/OBSERVABILITY.md`
- `docs/RELEASE_GUARDS.md`

Before changing feature code, also check `docs/requirements/` for a PRD.

---

## Operating Rules

- Keep shared deployment setup consistent across projects unless the PRD clearly
  calls for a different architecture.
- Never commit `.env`, Firebase service files, Railway dumps, Sentry tokens, or
  raw logs.
- Never push directly to `main` unless Joseph explicitly declares an emergency
  hotfix.
- Do not run long `gh run watch`, EAS, or Firebase polling unless Joseph asks.
  Prefer one-time status checks and run/build URLs.
- When adding backend env vars, update `src/config.py`, `.env.example`,
  `tests/conftest.py`, and `.github/workflows/ci.yml` in the same commit.
- Run tests before declaring done when the project has a test suite.
