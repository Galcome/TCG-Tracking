# Daily free-price refresh

The pricing refresh is a display-only maintenance job. It updates the separate
`current_market_quotes` table and appends provider history when appropriate; it never
changes purchases, cost basis, sales, profit, or the manual Vault valuation.

## Deployment shape

Run `src.jobs.pricing_refresh` as a private Railway Cron service. The API service remains
the only service with `preDeployCommand: uv run alembic upgrade head`; the cron service
does not run migrations or expose a health-check endpoint.

The repository captures the intended service settings in
[`railway.pricing-refresh.json`](../railway.pricing-refresh.json). Configure the service's
**Config File Path** (or equivalent Railway dashboard settings) to that file and set the
cron schedule to `17 7 * * *` (07:17 UTC daily). Railway schedules are UTC, may run a few
minutes late, and skips a new invocation while an earlier invocation is still active.

The service must remain private: do not assign it a public domain. Its authentication is
the Railway-managed secret `DATABASE_URL` connection to Neon plus the explicit
`APP_ROLE=worker` process guard. It does not accept a Firebase token or call the public
refresh route. Copy the API service's production values for the settings that the shared
configuration validates:

| Variable | Worker value |
| --- | --- |
| `APP_ENV` | `production` |
| `APP_ROLE` | `worker` |
| `DATABASE_URL` | Same Neon pooled/runtime URL as the API, stored as a Railway secret/reference |
| `DIRECT_DATABASE_URL` | Blank; the API owns migrations |
| `FIREBASE_PROJECT_ID` | Same project ID as the API (required by shared settings) |
| `ALLOWED_MEMBER_EMAILS` | Same production allowlist (required by shared settings) |

Do not put a database URL, member list, or any generated credential in this repository.

## Failure and overlap behavior

The service makes at most three attempts. It retries database errors, an occupied
PostgreSQL advisory lock, and systemic TCGCSV marker or Bank of Canada FX failures with
bounded delays. The final failure exits nonzero so Railway marks the run failed and its
logs/notifications show the incident. The existing transaction-scoped advisory lock is
held during the refresh, so two workers cannot replace one another's current quote.

An individual missing product, malformed price, or unavailable group is different: the
last successful quote remains in place and is marked `stale`, or the product is
`unavailable` when no quote has ever succeeded. The job logs those item errors and exits
successfully because the rest of the catalogue completed. The Inventory, Store, Product,
and Vault screens show the status and capture date for review.

Inspect one bounded set of logs after a first deployment or incident:

```powershell
railway logs --service pricing-refresh --environment production --lines 200
```

Look for `pricing_refresh_complete`, `pricing_refresh_item_errors`,
`pricing_refresh_systemic_failure`, or `pricing_refresh_aborted`. A successful run with
`refreshed=0` can be correct when the TCGCSV daily marker has not changed; a run with
`stale>0` or `unavailable>0` needs provider/mapping review.

## Manual check

For a local maintenance run, use a disposable/test database or the production worker
service environment only after confirming the target:

```powershell
$env:APP_ENV = "test"
$env:APP_ROLE = "worker"
uv run python -m src.jobs.pricing_refresh
```

The browser's authenticated `POST /api/v1/pricing/refresh` remains available for an
operator-triggered refresh. It is separate from the private cron process.

## Product boundaries

Gemini is an identity assistant only and does not update prices or participate in this job.
No Groq integration currently exists; any future provider must keep the same identity-only
boundary. TCGCSV is a free USD source converted with the dated Bank of Canada USD/CAD rate;
its market price is not condition-specific. Slabs remain manual.
