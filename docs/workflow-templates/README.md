# Workflow Templates

These files are examples for child projects. They are intentionally stored outside
`.github/workflows` and use the `.yml.example` suffix so the template repo never runs
mobile builds.

When a real Expo app is ready for tester builds:

1. Copy the example workflows into the child repo's `.github/workflows/` directory.
2. Remove the `.example` suffix.
3. Replace placeholder artifact names, Sentry project slugs, and tester group defaults.
4. Confirm GitHub/EAS/Firebase secrets exist.
5. Dispatch the start workflow manually from `main` after CI is green.

Do not add these as active workflows to the base template repo.
