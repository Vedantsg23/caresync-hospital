# Deployment

A deployment starts **empty**. No patients, no staff, no demo accounts, no
shared password. The build applies migrations and nothing else. You create the
first administrator yourself, once, and everybody else is invited or approved by
a human.

That is the whole difference between this and a demonstration, and it is why the
steps below are not "push and go".

## Before you start

You need two things:

| | |
|---|---|
| A PostgreSQL 16 database | Neon, Supabase, Vercel Postgres, RDS, or your own |
| `AUTH_SECRET` | `openssl rand -base64 48` |

Everything else has a working default. Mail is recorded rather than sent, rate
limits are per-instance, and the AI layer is the offline summariser, until you
configure otherwise.

## 1. Environment

Set these in your hosting provider. Full list with comments in `.env.example`.

**Required**

```
DATABASE_URL      # pooled connection string
AUTH_SECRET       # 32+ characters, from openssl above
```

**Strongly recommended**

```
DIRECT_URL        # non-pooled, for migrations (Neon/Supabase)
APP_ORIGIN        # https://your-host — links in emails point here
BOOTSTRAP_TOKEN   # 24+ random characters; see step 3, then remove it
MAIL_DRIVER       # resend or smtp, with RESEND_API_KEY / SMTP_URL
```

**If you run more than one instance**

```
REDIS_URL         # Upstash REST URL
REDIS_TOKEN       # Upstash REST token
```

Without these the rate limiter counts per instance, which on *n* instances lets
through roughly *n* times the configured limit. See `docs/SCALING.md`.

**Leave unset in production**

```
SEED_FORCE                    # destroys the database on every build while set
NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS
NEXT_PUBLIC_DEMO_PASSWORD
SEED_ALLOW_PRODUCTION
```

> One trap worth knowing: some dashboards (Vercel included) will happily store
> an environment variable as an **empty string**. Zod's `.default()` only fires
> on `undefined`, not on `""`, so an empty value used to defeat every default
> and take the whole application down with a `500` on sign-in. `src/lib/env.ts`
> now strips empty values before validating. Set a variable properly or delete
> it; do not leave it blank.

## 2. Deploy

### Vercel

1. Import the repository.
2. Set **Build Command** to `npm run vercel-build`. It runs
   `npm run db:migrate && next build` — migrations, then the build. It does
   **not** seed.
3. Add the environment variables from step 1.
4. Deploy.

Migrations are additive and idempotent, so redeploying is safe and repeated
builds are no-ops for the database.

### Anywhere else

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

Any Node 20+ host works. The application is stateless: sessions live in
PostgreSQL, and realtime updates poll a database cursor rather than an
in-process bus, so instances can be added, killed and replaced freely.

## 3. Create the first administrator

The database is empty, so there is nobody to sign in as and nobody to approve
the first registration. `POST /api/auth/bootstrap` breaks that circle exactly
once.

```bash
curl -X POST https://your-host/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{
    "token": "THE VALUE OF BOOTSTRAP_TOKEN",
    "email": "you@your-hospital.org",
    "fullName": "Your Name",
    "password": "a password only you know"
  }'
```

- The token is compared in constant time.
- The endpoint **refuses to run if any active administrator already exists**, so
  it cannot be used to add a second way in later.
- Remove `BOOTSTRAP_TOKEN` from the environment afterwards. It is inert once an
  administrator exists, but there is no reason to keep it.

Then sign in and set the hospital up: departments, wards and beds first, because
staff and admissions reference them.

## 4. Let people in

Two routes, both requiring a human decision:

**They register, you approve.** They fill in `/register` with the role they are
applying for and whatever identifies them professionally. They confirm their
email. The request appears at `/admin/registrations`, where **you** choose the
role and department that are actually granted — which need not be what they
asked for. Nothing they can send makes them an administrator.

**You invite them.** `/admin/staff` → *Invite a colleague*. You pick the role
and department up front, they set their own password, and the account is active
immediately because you have already vouched for it.

## 5. Verify

```bash
curl https://your-host/api/health      # configuration and reachability
curl https://your-host/api/health/db   # pool, latency, migrations, drivers
```

`/api/health/db` returns:

```json
{ "database": { "reachable": true, "latencyMs": 8.3, "migrationsApplied": 6 },
  "pool": { "total": 1, "idle": 1, "waiting": 0, "max": 5 },
  "limiter": "memory", "mail": "console" }
```

Read it as a checklist. `migrationsApplied` should match the number of files in
`database/migrations/`. `limiter` should say `redis` if you run more than one
instance. `mail` should not say `console` if you expect people to receive
verification emails. **`pool.waiting` above zero for any sustained period is
pool exhaustion**, and is the one number worth alerting on.

If configuration is wrong, `/api/health` names the offending **variables** —
names only, never values.

## Ongoing

**Migrations.** Add a numbered file to `database/migrations/`. Additive and
idempotent; `npm run db:migrate` runs anything not yet applied and records it in
`_caresync_migrations`. The build runs it, so a deploy is a migration.

**Logs.** One JSON object per line, with a request id echoed in `x-request-id`.
Fields are allow-listed, so no patient data reaches them — which also means a
log will tell you *which* request failed, never *whose* record it was. For that,
use the audit trail at `/admin/audit`. `LOG_LEVEL` defaults to `info` in
production.

**Backups.** Whatever your provider offers, plus a restore you have actually
tested. This application does not back itself up, and the audit trail is
append-only within the database, not outside it.

## Running the demonstration hospital instead

If what you want is the demo — invented patients, staff across every role, a
referral mid-flight — that is a development thing:

```bash
cp .env.example .env        # set DATABASE_URL and AUTH_SECRET
npm run db:setup            # migrate + seed
npm run dev
```

`npm run db:seed` **refuses to run when `NODE_ENV=production`**. Overriding it
takes `SEED_ALLOW_PRODUCTION=true`, deliberately, for one run. Invented patients
must never sit in a database where a real one could be looked up, and a
shared-password demo account must never exist alongside real records.

To show the demo publicly, deploy a second, clearly-labelled instance with its
own database and that variable set — not the one people are meant to use.
