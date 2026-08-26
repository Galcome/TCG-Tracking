# Backups And Restore

Neon's own recovery is the first layer and it is faster than anything here. This
is the second layer, and it exists for a different failure.

The risk is not that Neon loses the data. It is that **we break it and do not
notice for two days**. `railway.json` runs `alembic upgrade head` as a
`preDeployCommand`, so every deploy migrates production the moment CI goes green.
A migration that quietly rewrites cost basis, an accidental bulk delete, a bug
that corrupts rows - none of those page anyone. You find them when a report looks
wrong. If the recovery window is shorter than that detection lag, the data is
gone while everything still appears to be working.

So the point of these dumps is not disaster recovery. It is **a recovery window
longer than our detection lag**.

## What runs

`.github/workflows/backup.yml`, nightly at 07:17 UTC and on demand.

Each run writes three objects to R2:

| Object | What it is |
| --- | --- |
| `<prefix>/<stamp>/dump.pgcustom.gpg` | `pg_dump --format=custom`, AES256 encrypted |
| `<prefix>/<stamp>/manifest.json.gpg` | Exact row counts, money totals, migration head |
| `<prefix>/latest.txt` | The stamp of the newest good run |

`latest.txt` is written last and only on success, so it never points at a
half-finished run. Runs older than `BACKUP_RETENTION_DAYS` (default 30) are
pruned at the end of each run.

## The spend ceiling

R2 has **no hard spend cap** - Cloudflare offers usage alerts but nothing that
stops the service at a threshold. So the ceiling lives in the script.

`BACKUP_MAX_DUMP_MB` (default 100) fails the run if a dump exceeds it, *before
anything is uploaded*. At the default 30-day retention that bounds the bucket at
roughly 3 GB against a 10 GB free tier.

For scale: a dump of the ledger is currently about **63 KB**. Thirty of those is
under 2 MB. Tripping a 100 MB ceiling would mean something changed that nobody
intended - a table that stopped being pruned, an import gone wrong, binary data
landing in a column that used to hold text.

The trade is deliberate: a trip means **no new backup until someone looks**. A
loud gap you will notice beats a quiet bill you will not. If the growth is
legitimate, raise the ceiling on purpose rather than removing the check.

Worth pairing with a Cloudflare billing alert as a second tripwire - it will not
stop anything, but you will know.

**The manifest is the part that matters.** A dump that restores without error
proves nothing - it can be missing rows and still load cleanly. A dump whose row
counts and cent totals match what the source held at capture time proves the
round trip. Money is integer cents, so those totals are exact and any drift shows
up as an inequality rather than a rounding argument.

The manifest and the dump read from **one exported repeatable-read snapshot**.
Measuring them separately would let an ordinary write land between the two, and
the drill would then report corruption that never happened - which is worse than
no check at all, because it teaches you to ignore the one that matters.

## Secrets to set

Repository secrets, all required:

| Secret | Value |
| --- | --- |
| `BACKUP_DATABASE_URL` | Neon's **unpooled/direct** URL, not the pooler |
| `BACKUP_ENCRYPTION_PASSPHRASE` | A long random passphrase. Store it somewhere that is not this repo and not R2 |
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | R2 API token, object read/write on that bucket only |
| `R2_SECRET_ACCESS_KEY` | The token's secret |

Two things worth being deliberate about:

- **Keep the passphrase out of R2.** If the bucket leaks and the passphrase is in
  it, the encryption bought nothing. A password manager is the right home.
- **Scope the R2 token to the one bucket.** These credentials sit in GitHub
  Actions; the blast radius of a leak should be one bucket of encrypted dumps.

A lifecycle rule on the bucket is worth adding as a backstop, so retention still
happens if the prune step is ever broken or skipped.

## Restoring

```bash
BACKUP_ENCRYPTION_PASSPHRASE=... \
R2_BUCKET=... R2_ENDPOINT=... \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_DEFAULT_REGION=auto \
RESTORE_TARGET_URL=postgresql://... \
./scripts/restore-backup.sh [stamp]
```

With no stamp it takes whatever `latest.txt` points at.

`RESTORE_TARGET_URL` must be a database you are willing to lose - the script
drops and recreates its `public` schema.

It refuses if the target is the database the backup came from. That check
compares host, port and database name rather than the URL text, because the same
database reached as `postgresql://` or `postgres://`, with a different sslmode,
or through a pooler hostname is textually different but is still the database you
must not destroy. It also refuses when `BACKUP_DATABASE_URL` is unset, because a
check that cannot run must not pass silently.

Restoring **into** production is a real recovery and sometimes exactly right. It
needs `RESTORE_ALLOW_SAME_DATABASE=i-know`, deliberately typed.

On success it prints the tables, rows and migration head it verified. On any
mismatch it lists exactly what differed and exits non-zero.

## The drill

**A backup nobody has restored is not a backup.** Run the drill quarterly:

Actions → Backup → Run workflow → tick **"Also restore into a scratch
database and verify"**.

That runs a fresh dump, then restores it into a disposable PostgreSQL service on
the runner and checks it against its own manifest. Nothing touches production and
no scratch database has to be kept standing between drills.

The drill is not nightly on purpose. A nightly restore needs a scratch database
standing by every night, which is cost for its own sake - but the drill has to be
one click away, or it never happens.

## PostgreSQL version skew

The backup job installs the client major that **matches the source server**,
detected at run time. This is deliberate and was found the hard way:

- `pg_dump` refuses to dump a server newer than itself.
- A *newer* `pg_dump` writes statements an older server rejects on the way back
  in. An 18 client emits `SET transaction_timeout`, and restoring that into a 16
  server fails.

Dumping with the server's own major avoids both ends. The restore drill uses the
newest client, because `pg_restore` reads archives from its own major and older,
and the scratch service is that same major.

When restoring into a real database, use a client major that matches the
**target**.

One trap worth knowing: on Ubuntu, `/usr/bin/pg_dump` is `pg_wrapper`, which
chooses a version itself. Installing `postgresql-client-18` is not enough - the
wrapper still ran the runner's preinstalled 16 and the dump failed on a version
mismatch. The workflow puts `/usr/lib/postgresql/<major>/bin` on PATH so the
client it just chose is the one that actually runs.

Neon is currently on **PostgreSQL 18.6**.

## If a backup fails

Scheduled workflow failures email the repository owner by default - check that
this is actually on, because a silent backup failure is worse than no backup at
all. A run that fails partway never writes `latest.txt`, so the previous good run
stays current.

## What this does not cover

- **Firebase Auth users.** Members are in PostgreSQL, but the identities they
  sign in with are in Firebase and are not dumped here.
- **Point-in-time recovery.** These are nightly snapshots. Anything written since
  the last run is only recoverable through Neon's own window.
