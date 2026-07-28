# Requirements

This folder holds PRD (Product Requirements Document) files for features and projects.

---

## Workflow

1. **Think it through in Claude.ai** — use the web interface to brainstorm, refine scope, and write the PRD
2. **Save the PRD here** as a `.md` file using the naming convention below
3. **Reference it in Claude Code** — when starting a build, say: "read docs/requirements/[filename].md"
4. Claude Code reads the file before writing any code

This keeps requirements separate from implementation and gives Claude full context without copy-pasting into chat.

---

## Naming Convention

```
YYYY-MM-DD-short-feature-name.md
```

Examples:
- `2026-02-21-user-authentication.md`
- `2026-03-05-dashboard-v1.md`

---

## PRD Template

When writing a PRD in Claude.ai, use this structure:

```markdown
# [Feature Name]

## Production intent
Live app / Internal tool / Prototype
<!-- This tells Claude how seriously to treat error handling, security, and edge cases.
     Live app = real users, real data, no shortcuts.
     Internal tool = known users, lower risk tolerance still applies.
     Prototype = explore and validate, not for real users. -->

## What it does
[1-2 sentences — plain English]

## Who it's for
[The user and their goal]

## Core requirements
- [Must have]
- [Must have]

## Out of scope
- [Explicitly excluded to avoid scope creep]

## Success looks like
[How we know it's done and working]

## Open questions
- [Anything unresolved before building]
```
