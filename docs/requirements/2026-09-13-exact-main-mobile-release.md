# Exact-main mobile release from isolated worktrees

Production intent: Live app; internal Android alpha. Required to ship the installed-app corrections without moving Joseph's primary checkout, where local main is already checked out.

## Decision

Replace the local branch-name test with an exact remote-origin main SHA check. A detached worktree at that commit is eligible; an unmerged feature commit is not. Require a clean app source tree, including untracked source files, so a fresh receipt cannot authorize uncommitted code that CI never tested; ignored native/config/build artifacts remain allowed. Retire the first-internal-build environment exception. Require the newest matching run for both `ci.yml` and `expo-checks.yml` on main to be completed successfully; missing, pending, failed, cancelled or malformed results fail closed, even if an older run succeeded. Subprocess checks have bounded time/output and never expose raw errors.

Keep approved certificate, APK package/version, source fingerprint and APK-byte receipt checks unchanged. Changed app sources require a fresh higher-version APK and generated receipt; never rewrite an old receipt to authorize changed sources. No cloud Android builds, automatic Firebase uploads or Hosting cutover.

The existing CI foundation PR #86 enables exact-main Expo checks after every main/dev push and cancels superseded runs. Until it is merged, explicitly dispatch `expo-checks.yml` on main and wait for its successful result before distributing. Main CI continues to publish Vite, not Expo.

## Verification and release sequence

1. Inject command responses in unit tests; do not contact GitHub or Firebase during tests. Verify exact SHA, both workflows, newest-result rejection and sanitized failure paths.
2. Merge reviewed correction PRs through normal PR workflow after their checks pass.
3. Fetch origin and detach the assigned Codex worktree at origin/main; preserve the primary checkout and unrelated untracked files.
4. Wait for successful backend/Vite and Expo checks for that exact commit.
5. Use Node 22, PowerShell 5.1 and the documented local Gradle build command; generate a new signed APK and receipt.
6. Run deliberate distribution to existing Firebase `alpha`. Version 0.1.1 (2) is the planned correction release.
7. Record the release link; installed-device keyboard/back/camera/share/telemetry acceptance remains pending until tested. Do not promote Expo Hosting based on browser fixtures or compilation alone.

Status: implemented and root-reviewed, including clean-source and bounded-command corrections. Focused guard/wiring tests, full app unit suite, lint, type checking and PowerShell syntax checks pass locally. Independent fresh reviewer unavailable because this conversation reached its agent-thread limit; no such review is claimed. PR/main CI and a fresh signed build remain required. No new upload performed.
