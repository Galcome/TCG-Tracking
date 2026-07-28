# Agent Worktree Guide

Use one physical worktree per agent and one task branch per assignment. This
keeps Codex, Claude, Gemini, Antigravity, and Joseph from stacking unrelated
changes onto the same branch.

## Default Layout

For a repo cloned as `C:\Users\josep\Git\<repo-name>`:

| Owner | Worktree path | Idle branch |
| --- | --- | --- |
| Codex | `C:\Users\josep\Git\<repo-name>-codex` | `codex/idle` |
| Claude | `C:\Users\josep\Git\<repo-name>-claude` | `claude/idle` |
| Gemini | `C:\Users\josep\Git\<repo-name>-gemini` | `gemini/idle` |
| Antigravity | `C:\Users\josep\Git\<repo-name>-antigravity` | `antigravity/idle` |

The idle branches are parking branches only. Real work still happens on a fresh
task branch.

## One-Time Setup

From the main repo clone:

```powershell
.\scripts\setup-agent-worktrees.ps1
```

Preview what the script would create:

```powershell
.\scripts\setup-agent-worktrees.ps1 -DryRun
```

Manual equivalent:

```powershell
git fetch origin --prune
git worktree add ..\<repo-name>-codex -b codex/idle origin/main
git worktree add ..\<repo-name>-claude -b claude/idle origin/main
git worktree add ..\<repo-name>-gemini -b gemini/idle origin/main
git worktree add ..\<repo-name>-antigravity -b antigravity/idle origin/main
```

## Starting A Task

In the assigned agent worktree:

```powershell
git fetch origin --prune
git status --short --branch
git switch -c fix/short-task-name origin/main
```

Use `feature/**`, `fix/**`, `chore/**`, or `docs/**` branch names. Keep one
issue, feature, or fix per branch.

## If The Current Branch Is Dirty

If `git status` shows unrelated files:

1. Do not keep working in that branch.
2. Move to the assigned worktree.
3. Create a new task branch from `origin/main`.
4. Only bring over the specific files or commits Joseph asked to preserve.

This is especially important for shared files such as:

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `ANTIGRAVITY.md`
- `.github/workflows/**`
- `docs/DEPLOYMENT_TEMPLATE.md`
- `docs/RELEASE_GUARDS.md`
- `app/app.json`, `app/eas.json`
- `VERSION`, package files, lockfiles
- migrations

## PR Handoff

Before opening or updating a PR:

```powershell
git diff --check
uv run ruff check .
uv run pytest
```

For CI, do not use long-running watchers unless Joseph explicitly asks. Prefer:

```powershell
gh run list --branch <branch> --limit 5
gh run view <run-id> --log-failed
```

If another agent has a PR open, merge or rebase only when the branches touch the
same files or Joseph asks for integration.
