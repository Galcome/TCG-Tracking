# Commit database transactions before success responses

Production intent: Live app. Discovered during installed-app parity verification.

## Evidence and scope

Expo CI 34771498202 returned HTTP 201 for a confirmed pricing mapping, then an immediate GET returned an empty list. The request completed before the yielded database dependency committed. FastAPI's default request-scoped yield cleanup runs after sending the response; function scope runs before it ([official documentation](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/#early-exit-and-scope)). Rip verification also read zero remaining cost immediately after a successful transformation; investigation must distinguish visibility timing from actual allocation errors.

Use explicit function scope consistently for every production database dependency, including member resolution. Preserve dependency overrides, one shared session per request, rollback handling, NullPool, integer-cent accounting and existing response serialization. Do not change FIFO algorithms or weaken financial assertions. No new environment variables or migrations.

## Acceptance

- Deterministic ASGI tests assert commit and session cleanup happen before sending a success response.
- A commit failure produces an error response, never an already-sent success.
- Endpoint errors roll back rather than commit.
- An audit test rejects production database dependencies with a different scope.
- Backend, Vite and Expo CI pass, including unchanged rip/pricing assertions.
- Keep this correction in a separate PR from the mobile visual changes; mobile release remains gated on exact-main CI.

Status: all 57 dependency declarations now explicitly use function scope. Four deterministic non-database tests cover success ordering, rollback ordering, commit failure and the production dependency graph. Local targeted suite: 71 passed; ruff and diff checks passed. Root reviewed the change and corrected an initial test weakness by using one chronological lifecycle/send timeline. A new independent Terra review could not be started because this conversation reached its agent-thread limit; do not describe that review as completed. Database-backed backend and browser CI are still required. No production deployment performed.
