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

## Native Builds And Disk Space

A local Android build writes about 10 GB of native output into that worktree
(`android/**/build`, `.cxx`, and the `android/build` folders inside
`node_modules`). Across many worktrees this fills the disk.

- Do not run Android release builds, `expo prebuild`, `expo run:android`, or
  `gradlew` in a task or agent worktree unless Joseph asks in the current
  thread. Verify mobile changes with the app's tests, typecheck, and
  `npx expo export`.
- If you do run a native build, delete its output before finishing:
  `android/**/build`, `android/**/.cxx`, and `node_modules/**/android/build`
  and `.cxx`. Keep the release APK elsewhere if it is needed.
- Do not add ABI restrictions (`reactNativeArchitectures=`) to save space;
  release APKs ship every ABI.

## Worktree Hygiene

The per-agent worktrees above are permanent. Any extra worktree created for a
single task is removed once its PR merges:

```powershell
git worktree remove ..\<repo-name>-<task>
git branch -d <task-branch>
```

Do not remove a worktree that has uncommitted changes or belongs to another
agent's active task.

`git worktree remove` deletes ignored files without warning. Before removing a
worktree, check for `app/.native-release/` (the Android release signing key)
and make sure a backup or another worktree still holds it. Losing it means
testers can never receive an update over their installed app.
