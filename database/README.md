# 1StopQuantum database

The database is portable PostgreSQL SQL, applied in this order:

1. `schema.sql` creates accounts, subscriptions, plans, scheduled jobs, run
   history, engagement events, feedback, administrator settings, community
   submissions, consent/retention fields, and moderation audit history.
2. `seed.sql` idempotently imports the Explorer, Scholar, and Lab plan catalog.

## Apple Silicon setup

The main `scripts/setup.sh` performs these steps automatically. To install and
provision PostgreSQL separately on an M-series Mac:

```bash
brew install postgresql@16
brew services start postgresql@16
export PATH="$(brew --prefix postgresql@16)/bin:$PATH"
./scripts/setup-postgres.sh
```

The script installs/starts PostgreSQL when needed, creates the application role
and database, applies both SQL files, and writes `DATABASE_URL` to the ignored
`.env`. It is safe to rerun: tables use `IF NOT EXISTS` and plan rows use an
upsert. Fresh environments receive this initial catalog:

| Code | Job limit | Iteration limit |
| --- | ---: | ---: |
| Explorer | 1 | 2 |
| Scholar | 10 | 4 |
| Lab | 50 | 8 |

Confirm the service, connection, and schema after provisioning:

```bash
set -a; source .env; set +a
pg_isready -h 127.0.0.1 -p 5432
psql "$DATABASE_URL" -c 'select current_database(), current_user;'
psql "$DATABASE_URL" -c '\dt'
```

Expected tables include `users`, `subscriptions`, `plans`, `improvement_jobs`,
`improvement_runs`, `page_events`, `content_feedback`, `llm_settings`,
`community_submissions`, and `community_audit_log`.

To apply the portable SQL manually to an existing database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
```

For a managed PostgreSQL instance, set `POSTGRES_ADMIN_URL`,
`QUANTUMYOG_DB_NAME`, `QUANTUMYOG_DB_USER`, and `QUANTUMYOG_DB_PASSWORD`
before running the same script. Application runtime uses only `DATABASE_URL`.
No payment or card data is stored; `subscriptions` represents local educational
entitlements only.

The users table includes a `password_hash` for returning local learners. Product
signup requires an 8-128 character password. The idempotent migration disables
preexisting null-password rows before making the column `NOT NULL`.
The schema contains `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so reapplying it
migrates databases created before sign-in support without deleting existing users.
It also includes optional password hint, recovery-question, and hashed-answer
columns. Recovery endpoints never return the answer hash or any password field.

Provisioning idempotently creates the local Scholar test account
`learner@1stopquantum.local` with password `LearnQuantum2026!` and recovery answer
`superposition`. This predictable account is only for local classroom and judge
testing; change or remove it before exposing an environment publicly.

## Internal administration

`scripts/setup.sh` generates `QUANTUMYOG_ADMIN_EMAIL`,
`QUANTUMYOG_ADMIN_PASSWORD`, and `LLM_SETTINGS_ENCRYPTION_KEY` in the ignored
`.env`, then `scripts/provision_postgres.py` idempotently creates the internal
administrator on first provision. A later dashboard password change is stored in
PostgreSQL; provisioning never overwrites that hash from `.env`. The public signup
API always creates a `learner`; it cannot grant `admin`. Approval may promote a
matching learner to `contributor` or `reviewer`; only provisioning establishes an
internal administrator.

`page_events` stores privacy-minimized visitor IDs and page keys.
`content_feedback` stores helpful votes or written accuracy reports from guests
and signed-in learners. `llm_settings` is a singleton provider configuration for
the local OpenAI-compatible endpoint or OpenAI. API keys are encrypted with
Fernet before insertion, are never returned by admin APIs, and are not logged.

Back up the encryption key securely with the database. Losing it makes the
stored provider key undecryptable; changing it requires saving a new API key.

## Backup and restore

Load `DATABASE_URL` from `.env`, save the database in PostgreSQL's portable custom
format, and keep the ignored `.env` (especially `LLM_SETTINGS_ENCRYPTION_KEY`) in
a separate secret store:

```bash
set -a; source .env; set +a
mkdir -p backups
pg_dump --format=custom --file=backups/1stopquantum.dump "$DATABASE_URL"
```

Restore into an already-created empty target database with:

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname="$TARGET_DATABASE_URL" backups/1stopquantum.dump
```

Do not commit dumps: they can contain emails, password hashes, learner activity,
moderation records, and encrypted provider credentials. Add any custom backup
directory to `.gitignore` before storing dumps under the project tree.

`community_submissions` stores initial name/email contact, explicit consent,
24-month retention, workflow state, and deletion-request time.
`community_audit_log` records every moderation transition. Public APIs return
approved records only and remove email, consent/retention dates, review notes,
and administrator identifiers.
