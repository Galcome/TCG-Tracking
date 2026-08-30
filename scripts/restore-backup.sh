#!/usr/bin/env bash
#
# Restore a backup into a throwaway database and prove it is intact.
#
# A backup nobody has restored is not a backup, it is a hope. Run this quarterly
# against a scratch database, and for real the day something goes wrong.
#
#   BACKUP_DATABASE_URL=... R2_BUCKET=... R2_ENDPOINT=... \
#   BACKUP_ENCRYPTION_PASSPHRASE=... RESTORE_CONFIRM=DROP_TARGET_SCHEMA \
#   RESTORE_TARGET_URL=postgresql://... ./scripts/restore-backup.sh [stamp]
#
# With no stamp it takes whatever `latest.txt` points at. RESTORE_TARGET_URL must
# be a database you are willing to lose: this drops and recreates its schema. A
# same-database recovery additionally requires RESTORE_ALLOW_SAME_DATABASE=i-know.

set -euo pipefail

: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${RESTORE_TARGET_URL:?RESTORE_TARGET_URL is required - a scratch database, not production}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"

# Every restore drops the target's public schema, including a supposedly disposable
# scratch database. A separate confirmation is deliberately required even when the
# source and target appear different: DNS aliases, poolers, and mistaken environment
# variables are exactly how a destructive guard gets bypassed. The operator must type the
# same phrase in the environment for each invocation.
if [ "${RESTORE_CONFIRM:-}" != "DROP_TARGET_SCHEMA" ]; then
  echo "REFUSING: every restore drops the target schema." >&2
  echo "Set RESTORE_CONFIRM=DROP_TARGET_SCHEMA for this deliberate operation." >&2
  exit 1
fi

PREFIX="${BACKUP_PREFIX:-tcg-tracking}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

s3() { aws s3 --endpoint-url "$R2_ENDPOINT" "$@"; }

# Refuse to point this at the live database by accident. The next thing this
# script does is DROP SCHEMA ... CASCADE, so being wrong here destroys the exact
# thing the backups exist to protect. The explicit confirmation above remains
# mandatory even when this comparison says the endpoints differ.
#
# Comparing the two URLs as strings was not enough: the same database reached as
# `postgresql://` and `postgres://`, or with a different sslmode, or via a pooler
# hostname, is textually different and would have sailed straight through. And
# with BACKUP_DATABASE_URL simply unset the comparison could never match at all,
# which turned the guard off silently rather than loudly. Either is how you lose
# a ledger.
#
# So: compare identities observed after connecting, and fail closed when we cannot.
if [ -z "${BACKUP_DATABASE_URL:-}" ]; then
  echo "REFUSING: BACKUP_DATABASE_URL is unset, so the safety check cannot run." >&2
  echo "Set BACKUP_DATABASE_URL so both database identities can be checked." >&2
  exit 1
fi

same="$(python3 "$(dirname "$0")/_same_database.py" "$RESTORE_TARGET_URL" "$BACKUP_DATABASE_URL")" || {
  echo "REFUSING: could not verify the target and source database identities." >&2
  exit 1
}
if [ "$same" = "same" ]; then
  if [ "${RESTORE_ALLOW_SAME_DATABASE:-}" != "i-know" ]; then
    echo "REFUSING: target identity matches the backup source." >&2
    echo "This recovery requires RESTORE_ALLOW_SAME_DATABASE=i-know in addition to RESTORE_CONFIRM=DROP_TARGET_SCHEMA." >&2
    exit 1
  fi
  echo "NOTICE: target identity matches the backup source; both confirmations accepted." >&2
fi

STAMP="${1:-}"
if [ -z "$STAMP" ]; then
  s3 cp "s3://$R2_BUCKET/$PREFIX/latest.txt" "$WORK/latest.txt" --quiet
  STAMP="$(tr -d '[:space:]' < "$WORK/latest.txt")"
fi
echo "==> Restoring $PREFIX/$STAMP"

s3 cp "s3://$R2_BUCKET/$PREFIX/$STAMP/dump.pgcustom.gpg" "$WORK/dump.pgcustom.gpg" --quiet
s3 cp "s3://$R2_BUCKET/$PREFIX/$STAMP/manifest.json.gpg" "$WORK/manifest.json.gpg" --quiet

echo "==> Decrypting"
for f in dump.pgcustom manifest.json; do
  gpg --batch --yes --quiet --decrypt --passphrase-fd 0 \
      --output "$WORK/$f" "$WORK/$f.gpg" <<< "$BACKUP_ENCRYPTION_PASSPHRASE"
done

echo "==> Loading into the target"
psql "$RESTORE_TARGET_URL" -v ON_ERROR_STOP=1 -qX -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
# --exit-on-error so a partial restore is a failure, not a warning scrolled past.
pg_restore --dbname "$RESTORE_TARGET_URL" --no-owner --no-privileges \
           --exit-on-error "$WORK/dump.pgcustom"

echo "==> Verifying against the manifest"
psql "$RESTORE_TARGET_URL" -v ON_ERROR_STOP=1 -qtAX -o "$WORK/restored.json" <<'SQL'
SELECT jsonb_pretty(jsonb_build_object(
  'alembic_version', (SELECT version_num FROM alembic_version LIMIT 1),
  'table_counts', (
    SELECT jsonb_object_agg(table_name, cnt) FROM (
      SELECT c.table_name,
             (xpath('/row/cnt/text()', query_to_xml(
                format('SELECT count(*) AS cnt FROM %I.%I', c.table_schema, c.table_name),
                false, true, '')))[1]::text::bigint AS cnt
      FROM information_schema.tables c
      WHERE c.table_schema = 'public' AND c.table_type = 'BASE TABLE'
    ) counted
  ),
  'checksums', jsonb_build_object(
    'money_postings_delta_cents', (SELECT coalesce(sum(delta_cents), 0) FROM money_postings),
    'purchases_gross_cents', (SELECT coalesce(sum(gross_amount_cents), 0) FROM purchases),
    'purchases_shipping_cents', (SELECT coalesce(sum(shipping_cents), 0) FROM purchases),
    'purchases_tax_cents', (SELECT coalesce(sum(tax_cents), 0) FROM purchases),
    'purchases_fees_cents', (SELECT coalesce(sum(fees_cents), 0) FROM purchases),
    'sales_gross_cents', (SELECT coalesce(sum(gross_amount_cents), 0) FROM sales),
    'sales_cost_basis_cents', (SELECT coalesce(sum(cost_basis_cents), 0) FROM sales),
    'cost_allocations_cost_cents', (SELECT coalesce(sum(cost_cents), 0) FROM cost_allocations)
  )
));
SQL

python3 - "$WORK/manifest.json" "$WORK/restored.json" <<'PY'
"""Compare captured against restored. Every row and every cent, or it failed."""
import json
import sys

captured = json.load(open(sys.argv[1]))
restored = json.load(open(sys.argv[2]))

problems = []

if captured["alembic_version"] != restored["alembic_version"]:
    problems.append(
        f"migration head: captured {captured['alembic_version']}, "
        f"restored {restored['alembic_version']}"
    )

for table, expected in sorted(captured["table_counts"].items()):
    actual = restored["table_counts"].get(table)
    if actual != expected:
        problems.append(f"{table}: expected {expected} rows, restored {actual}")

missing = set(restored["table_counts"]) - set(captured["table_counts"])
for table in sorted(missing):
    problems.append(f"{table}: present after restore but not at capture")

for name, expected in sorted(captured["checksums"].items()):
    actual = restored["checksums"].get(name)
    if actual != expected:
        problems.append(f"{name}: expected {expected}, restored {actual}")

if problems:
    print("RESTORE VERIFICATION FAILED")
    for problem in problems:
        print(f"  - {problem}")
    sys.exit(1)

tables = len(captured["table_counts"])
rows = sum(captured["table_counts"].values())
print(f"Verified: {tables} tables, {rows} rows, all money totals match.")
print(f"Captured at {captured['captured_at']}, migration head {captured['alembic_version']}.")
PY

echo "==> Restore verified"
