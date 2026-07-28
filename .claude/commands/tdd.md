# Test-Driven Development

When building any new function, method, or endpoint — follow RED-GREEN-REFACTOR. No exceptions.

## RED — Write a Failing Test First
- Write the test before writing any implementation code
- The test must fail when run (proves the test is actually testing something)
- Test should cover: the happy path, at least one edge case, and one failure case
- Run `uv run pytest` to confirm it fails

```bash
uv run pytest tests/test_[module].py -v
```

## GREEN — Write the Minimum Code to Pass
- Write only enough code to make the test pass
- Do not add features, optimizations, or handling not covered by the current test
- Run `uv run pytest` to confirm it passes

## REFACTOR — Clean Up Without Breaking
- Improve the implementation: remove duplication, clarify names, simplify logic
- Do NOT add new behaviour during refactor
- Run `uv run pytest` after every change to confirm still green

## Repeat
For each new behaviour or edge case: RED → GREEN → REFACTOR

## When to Apply This
- Every new function that contains business logic
- Every new API endpoint
- Every bug fix (write a test that reproduces the bug first, then fix it)

**Do not write implementation code before the test exists.**
