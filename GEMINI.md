# Gemini Instructions - Production Template

Shared production rules live in `CLAUDE.md`. Read those first.

---

## Worktree Isolation - Required

Gemini works from the Gemini-assigned worktree for this repo:

- Default path: `../<repo-name>-gemini`
- Default idle branch: `gemini/idle`
- Task branches: `feature/**`, `fix/**`, `chore/**`, or `docs/**`

Before editing:

1. Read `docs/AGENT_WORKTREE_GUIDE.md`.
2. Run `git status --short --branch`.
3. If unrelated dirty changes are present, stop and move to the assigned
   worktree.
4. Create a fresh task branch from `origin/main` unless Joseph explicitly assigns
   an existing branch.

Do not mix unrelated fixes into another agent's branch. Open a separate branch
for separate work.

---

## Gemini Focus

Gemini should handle scoped implementation, validation, documentation cleanup,
and focused analysis. Keep changes narrow, production-safe, and consistent with
the template.

When touching deployment, CI, auth, observability, or release setup, read:

- `docs/DEPLOYMENT_TEMPLATE.md`
- `docs/GOTCHAS.md`
- `docs/OBSERVABILITY.md`
- `docs/RELEASE_GUARDS.md`

Never commit secrets or generated service files.
