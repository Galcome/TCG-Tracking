#!/usr/bin/env bash
#
# One encrypted database backup, pushed somewhere Neon cannot reach.
#
# Neon's own recovery is the first layer and it is faster than this. This is the
# second layer, and it answers a different question: not "did the provider lose
# the data" but "did we break it and not notice for two days". Railway runs
# `alembic upgrade head` on every deploy, so a destructive migration reaches
# production the moment CI goes green. Detection lag is the risk; a recovery
# window shorter than that lag is the failure.
#
# Writes three objects per run:
#   <prefix>/<stamp>/dump.pgcustom.gpg   the database
#   <prefix>/<stamp>/manifest.json.gpg   exact row counts and money totals
#   <prefix>/latest.txt                  the stamp of the newest good run
#
# The manifest is the point. A dump that restores without error still proves
# nothing; a dump whose row counts and cent totals match what the source held
# at capture time proves the round trip.

set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required - use the unpooled Neon URL}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"

PREFIX="${BACKUP_PREFIX:-tcg-tracking}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

s3() { aws s3 --endpoint-url "$R2_ENDPOINT" "$@"; }
s3api() { aws s3api --endpoint-url "$R2_ENDPOINT" "$@"; }

echo "==> Capturing manifest"
# Exact counts, not pg_stat_user_tables' estimates - an estimate cannot verify a
# restore. query_to_xml is the standard idiom for counting every table in one pass.
psql "$BACKUP_DATABASE_URL" -v ON_ERROR_STOP=1 -tAX -o "$WORK/manifest.json" <<'SQL'
SELECT jsonb_pretty(jsonb_build_object(
  'captured_at', now(),
  'alembic_version', (SELECT version_num FROM alembic_version LIMIT 1),
  'server_version_num', current_setting('server_version_num')::int,
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
  -- Money is integer cents on purpose, so these totals are exact and any drift
  -- through the dump/restore round trip shows up as an inequality, not a rounding
  -- argument.
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

# ON_ERROR_STOP above turns a bad query into a non-zero exit, but an empty or
# truncated file would still upload happily. The manifest is the only thing that
# can later prove the dump was whole, so it gets checked before anything ships.
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['table_counts'], 'no tables counted'; assert d['alembic_version'], 'no migration head'" "$WORK/manifest.json"

echo "==> Dumping"
# Custom format: compressed, and pg_restore can go selectively into a scratch
# database during a drill without replaying the whole thing.
pg_dump "$BACKUP_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file "$WORK/dump.pgcustom"

echo "==> Encrypting"
# Symmetric AES256. The passphrase lives in the secret store, never on the runner
# disk beyond this process, and gpg is already on the runner so there is no extra
# supply-chain surface for the one tool standing between a leaked bucket and the
# whole ledger.
for f in dump.pgcustom manifest.json; do
  gpg --batch --yes --quiet \
      --symmetric --cipher-algo AES256 \
      --passphrase-fd 0 \
      --output "$WORK/$f.gpg" "$WORK/$f" <<< "$BACKUP_ENCRYPTION_PASSPHRASE"
  rm -f "$WORK/$f"
done

echo "==> Uploading to $PREFIX/$STAMP"
s3 cp "$WORK/dump.pgcustom.gpg" "s3://$R2_BUCKET/$PREFIX/$STAMP/dump.pgcustom.gpg"
s3 cp "$WORK/manifest.json.gpg" "s3://$R2_BUCKET/$PREFIX/$STAMP/manifest.json.gpg"

# Written last and only on success, so `latest` never points at a half-finished run.
printf '%s\n' "$STAMP" > "$WORK/latest.txt"
s3 cp "$WORK/latest.txt" "s3://$R2_BUCKET/$PREFIX/latest.txt"

echo "==> Pruning runs older than $RETENTION_DAYS days"
CUTOFF="$(date -u -d "$RETENTION_DAYS days ago" +%Y-%m-%dT%H-%M-%SZ)"
s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$PREFIX/" \
      --query 'Contents[].Key' --output text 2>/dev/null | tr '\t' '\n' | while read -r key; do
  [ -n "$key" ] || continue
  run="$(printf '%s' "$key" | awk -F/ '{print $2}')"
  # Only prune timestamped run directories; latest.txt has no stamp to compare.
  case "$run" in
    ????-??-??T??-??-??Z) ;;
    *) continue ;;
  esac
  if [[ "$run" < "$CUTOFF" ]]; then
    echo "    removing $key"
    s3 rm "s3://$R2_BUCKET/$key"
  fi
done

echo "==> Done: $PREFIX/$STAMP"
