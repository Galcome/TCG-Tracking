# Antigravity Instructions - Production Template

Shared production rules live in `CLAUDE.md`. Read those first.

---

## Worktree Isolation - Required

Antigravity works from the Antigravity-assigned worktree for this repo:

- Default path: `../<repo-name>-antigravity`
- Default idle branch: `antigravity/idle`
- Task branches: `feature/**`, `fix/**`, `chore/**`, or `docs/**`

Before editing:

1. Read `docs/AGENT_WORKTREE_GUIDE.md`.
2. Run `git status --short --branch`.
3. If unrelated dirty changes are present, move to the assigned worktree before
   changing files.
4. Create a fresh task branch from `origin/main` unless Joseph explicitly assigns
   an existing branch.

Do not layer unrelated fixes onto another agent's branch.

---

## Antigravity Focus

Antigravity should be used for broad implementation passes, architecture checks,
and end-to-end product flow validation. Keep branch ownership clear and do not
rewrite other agents' work without an explicit instruction from Joseph.

For deployment, CI, auth, observability, or release workflow changes, read:

- `docs/DEPLOYMENT_TEMPLATE.md`
- `docs/GOTCHAS.md`
- `docs/OBSERVABILITY.md`
- `docs/RELEASE_GUARDS.md`

Never commit secrets, generated Firebase service files, Railway dumps, or raw
logs.
