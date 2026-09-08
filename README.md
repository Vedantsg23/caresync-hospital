<div align="center">

# CareSync Hospital

**One Hospital. One Connected View of the Patient.**

A working hospital clinical-coordination platform. Nursing observations, clinical notes,
laboratory results, imaging reports, medication records and specialist referrals are
brought together on one patient record, so that when a clinician opens a patient they
never have to ask *"where is the information?"*

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.44-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Tests](https://img.shields.io/badge/tests-204_passing-3fb950)](#testing)

### ▶ [**caresync-hospital.vercel.app**](https://caresync-hospital.vercel.app)

**That deployment starts empty, on purpose.** There are no demo accounts on it and
no shared password — an account exists there because a person asked for one and an
administrator granted it. Registration is self-service; privilege never is.
See [Deployment](docs/DEPLOYMENT.md) for how the first administrator is created.

**To see the system working, run the demonstration hospital locally.** It takes
three commands and builds a whole hospital — wards, staff across every role,
patients mid-admission, results, a referral in flight:

```bash
cp .env.example .env    # set DATABASE_URL, and AUTH_SECRET from: openssl rand -base64 48
npm install && npm run db:setup
npm run dev             # sign in as doctor@caresync.demo / CareSync#2026
```

**The two-minute tour:** sign in as **doctor@caresync.demo**, open **Rahul Mehta**
(PT-2026-00142), and press **Refer to specialist** — pick Dr. Priya Mehta. Then sign in as
**specialist@caresync.demo**, accept it from the inbox and record a response. Sign back in
as the doctor: the reply is waiting in your notifications *and* written onto the patient's
chart as a specialist note. That loop is the point of the whole system.

Try the other accounts too, and notice what each one **cannot** reach. The nurse has no
prescribing button. Pathology sees only patients with a laboratory order. Authorization is
enforced in the database, not by hiding buttons — and a test suite attacks it to prove so.

*Demonstration data. Every patient, clinician and result is invented — see [NOTICE](NOTICE).*

</div>

---

## Contents

- [What this is](#what-this-is)
- [The primary workflow](#the-primary-workflow)
- [Features](#features)
- [Screens](#screens)
- [Architecture](#architecture)
- [Data model](#data-model)
- [Security model](#security-model)
- [Getting started](#getting-started)
- [Demo accounts](#demo-accounts)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Testing](#testing)
- [API reference](#api-reference)
- [Deployment](#deployment)
- [Limitations](#limitations)
- [Licence and use](#licence-and-use)

**Reference documents**

| | |
| --- | --- |
| [docs/API.md](docs/API.md) | Every endpoint, its permission and its shapes |
| [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Registration, approval, invitation, reset, sessions |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, the three authorization layers, the IDOR audit, and what is still weak |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to an empty database and creating the first administrator |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Profiling at 50,000 patients: what was slow, why, and by how much it improved |
| [docs/LOAD_TESTING.md](docs/LOAD_TESTING.md) | Measured throughput and latency — and what those numbers do not prove |
| [docs/SCALING.md](docs/SCALING.md) | What breaks first, in order |

---

## What this is

Hospitals do not have a data problem, they have a **connection** problem. Nurses record
observations, junior doctors write notes, radiology produces images, pathology produces
results, pharmacy manages medicines — and a consultant has to look in several places to
understand one patient.

CareSync connects those workflows around a shared patient record and a shared hospital
view. Authorised staff sign in by role, contribute information, and that information
reaches the people who need it without anyone chasing it.

This is a **complete, working full-stack application**, not a prototype:

- Every screen reads live data from PostgreSQL. There are no mock arrays and no fake API responses.
- Every button performs a real, persisted action.
- Authorization is enforced in the service layer *and* in the database, not by hiding UI.
- Every clinical action is attributed, timestamped, added to the patient timeline and written to an append-only audit trail.

---

## The primary workflow

The feature that justifies the product is the referral loop between a doctor and a specialist:

```
Dr. Aarav Sharma            CareSync                 Dr. Priya Mehta
(General Medicine)                                    (Cardiology)
      │                                                     │
      │  1. Refer to specialist                             │
      │     reason, clinical summary, symptoms,              │
      │     history, investigations, medications,            │
      │     priority                                        │
      ├───────────────► referral persisted ─────────────────►│  2. Notified in real time
      │                 timeline event                       │
      │                 audit entry                          │
      │                                                      │
      │                                          3. Opens the referral and sees the
      │                                             authorised patient context
      │                                                      │
      │  4. Notified ◄──── access granted ◄──────────────────┤  Accepts
      │                    care-team membership              │
      │                    specialist encounter opened       │
      │                                                      │
      │                                          5. Records assessment, findings,
      │                                             recommendations, treatment plan,
      │                                             follow-up
      │  6. Notified ◄──── response saved ◄──────────────────┤
      │                    written to the chart as a
      │                    specialist note
      │                                                      │
      │  7. Notified ◄──── referral completed ◄──────────────┤  Completes
      │                                                      │
      ▼                                                      ▼
   Sees the response on the referral and on the patient record.
   Timeline shows: created → accepted → response → completed.
   Audit trail shows every transition with its actor.
```

Accepting a referral is what **grants** the specialist scoped access to the record — a
row in `patient_access_grants`, tied to that referral, granted by the referring doctor,
and itself audited. Access is never implicit.

This whole loop is covered by [`tests/integration/referral-workflow.test.ts`](tests/integration/referral-workflow.test.ts),
which asserts 26 separate properties against a real database.

---

## Features

### Clinical

| Module | What it does |
| --- | --- |
| **Patient registry** | Registration, demographics, allergies, chronic conditions, emergency contacts, authorization-aware search by name / patient number / admission number |
| **Admissions** | Admit, assign bed, transfer between wards (bed occupancy moves, history preserved), discharge with summary |
| **Patient timeline** | One chronological feed across every department, cursor-paginated and filterable by event category |
| **Vitals** | Observation sets with an aggregate early-warning score; an abnormal set escalates the patient status and alerts the attending clinician |
| **Clinical notes** | Admission, progress, consultation, nursing, specialist and discharge notes — versioned, never overwritten |
| **Referrals** | The full doctor → specialist loop with a guarded state machine |
| **Pathology** | Orders, results flagged against reference ranges, critical-value escalation, per-analyte trends |
| **Radiology** | Requests, scheduling, study status, narrative reports, critical-finding flagging |
| **Pharmacy** | Prescribing with an allergy interlock, dispensing, and a medication administration record |
| **Messaging** | Directed staff-to-staff conversations, optionally scoped to a patient |
| **AI assistance** | Patient, laboratory, imaging, timeline and handover summaries — advisory, labelled, and incapable of writing to the chart |

### Operational

| Module | What it does |
| --- | --- |
| **Role dashboards** | A different live dashboard for doctors, nurses, pathology, radiology, pharmacy and administration |
| **Wards & beds** | Hospital → department → ward → bed, with a live bed board and occupancy |
| **Staff management** | Create accounts, assign roles and departments, reset passwords, deactivate leavers |
| **Audit trail** | Append-only record of access and change, including denied attempts |
| **Realtime** | Server-sent events push notifications and patient updates without a refresh |

---

## Screens

| | |
|---|---|
| **Doctor dashboard** — live caseload, patients needing attention, ward capacity | **Patient record** — the connected view, ten tabs |
| **Referral inbox** — incoming and outgoing, filtered by what needs action | **Referral detail** — the workflow state machine with accept / respond / complete |
| **Nursing ward list** — ordered by acuity, observations due surfaced first | **Pathology / radiology / pharmacy worklists** |
| **Bed board** — occupancy across every ward | **Administration** — hospital KPIs, department activity, audit trail |

---

## Architecture

```
Browser
  │  React 19 · Next.js App Router · Tailwind (Stitch design tokens)
  │  TanStack Query for server state · EventSource for realtime
  ▼
Route handlers  (src/app/api/**)          71 REST endpoints
  │  protectedRoute() — session → permission → rate limit → handler
  │  Zod validation on every mutating request
  ▼
Services  (src/server/services/**)        all business logic lives here
  │  assertPatientAccess() on every patient-scoped operation
  │  timeline + notification + audit written in the same transaction
  ▼
Drizzle ORM  (src/server/db/**)           parameterised queries only
  ▼
PostgreSQL                                 40 tables · RLS policies
                                           append-only audit trigger
                                           referral state-machine trigger
```

### Layout

```
src/
  app/
    (app)/                 authenticated shell + pages
    api/                   71 REST route handlers
    login/                 public sign-in
  components/
    ui/                    design-system primitives built on the Stitch tokens
    layout/                sidebar, header, notifications, global search
    providers.tsx          query client, toasts, auth context
  features/                screen-level composition, by domain
    dashboard/ patients/ referrals/ nursing/ departments/
    wards/ messaging/ admin/ help/
  hooks/
    use-realtime.ts        server-sent events subscription
  lib/
    api/client.ts          the single typed fetch wrapper
    api/endpoints.ts       typed endpoint functions
    env.ts                 fail-fast environment validation
    utils.ts               formatting helpers
  server/
    auth/                  password hashing, JWT sessions, request context
    core/                  errors, API envelope, audit, rate limit, route guard
    db/                    Drizzle schema + pooled client
    services/              business logic (one module per domain)
      ai/                  provider abstraction + offline and hosted providers
    validators/            Zod schemas shared by client and server
  types/
    rbac.ts                roles, permissions, the single permission matrix
    api.ts                 response models
database/
  migrations/              0000_init · 0001_hardening · 0002_row_level_security
scripts/
  migrate.ts  seed.ts  reset.ts
tests/
  unit/                    49 tests — permissions, state machine, scoring, validation
  integration/             80 tests — against a real PostgreSQL database
```

### Notable decisions

**Drizzle rather than Prisma.** Drizzle is pure TypeScript with no binary engine, which
keeps the build reproducible, the cold start small on serverless, and the generated SQL
inspectable. Migrations are plain `.sql` files you can read and review.

**A persisted timeline rather than a union query.** `timeline_events` is an append-only
projection. It paginates correctly, sorts deterministically, and lets a new department
contribute without the read path growing another join.

**Realtime by database cursor, not an in-process emitter.** The SSE endpoint polls the
database for events newer than a cursor. An in-process `EventEmitter` would work on one
server and silently fail across serverless instances; this behaves identically on both.

**An offline AI provider by default.** `AI_PROVIDER=heuristic` composes summaries
deterministically from the structured facts the caller already authorised. It is
reproducible, free, sends no data anywhere, and cannot hallucinate a value that is not in
the record. Point `AI_PROVIDER` at Anthropic or OpenAI for richer narrative; the callers
do not change.

---

## Data model

40 tables. The spine is:

```
PATIENT ──┬── ADMISSION ──┬── ENCOUNTER ──┬── CLINICAL NOTE (versioned)
          │               │               ├── VITAL SIGNS / OBSERVATION
          │               │               ├── INVESTIGATION ORDER ── RESULT
          │               │               ├── RADIOLOGY STUDY ── REPORT
          │               │               ├── MEDICATION ORDER ── ADMINISTRATION
          │               │               └── REFERRAL ── RESPONSE
          │               ├── CARE TEAM MEMBER
          │               └── ADMISSION TRANSFER
          ├── PATIENT ACCESS GRANT      who may see this record, and why
          ├── TIMELINE EVENT            the connected view
          ├── NOTIFICATION              who was told, and when
          └── AUDIT LOG                 append-only
```

<details>
<summary><strong>Full table list</strong></summary>

**Identity & access** — `users`, `roles`, `permissions`, `role_permissions`, `user_roles`,
`sessions`, `departments`, `staff_profiles`

**Patients** — `patients`, `patient_contacts`, `patient_access_grants`

**Hospital structure** — `wards`, `beds`

**Admissions** — `admissions`, `admission_transfers`, `encounters`, `care_team_members`

**Clinical records** — `clinical_notes`, `clinical_note_versions`, `vital_signs`, `observations`

**Investigations** — `investigations`, `investigation_orders`, `investigation_results`,
`radiology_studies`, `radiology_reports`

**Pharmacy** — `medications`, `medication_orders`, `medication_administrations`

**Referrals** — `referrals`, `referral_responses`

**Communication** — `notifications`, `conversations`, `conversation_participants`, `messages`

**System** — `attachments`, `file_blobs`, `audit_logs`, `timeline_events`, `ai_summaries`

Plus two views, `lab_orders` and `lab_results`, which expose the pathology slice of
`investigation_orders` / `investigation_results` under conventional names with no risk of
data drift.

</details>

---

## Security model

> Not a clinically validated system, and it has not been through any regulatory
> assessment. [docs/SECURITY.md](docs/SECURITY.md) has the full threat model,
> the IDOR audit, and an explicit list of what is still weak.

### Accounts

There are no predefined accounts and no shared password in a deployment. The
rule that shapes everything else:

> **Registration is self-service. Privilege is not.**

A registration writes `requested_role` and never `primary_role`. The only code
paths that write `primary_role` are approval by someone holding `user:approve`
and acceptance of an invitation issued by someone holding `user:invite`. An
attacker who posts `{"primaryRole": "HOSPITAL_ADMIN"}` gets an inactive nurse
account awaiting approval, exactly like everyone else.

Full lifecycle — verification, approval, invitation, reset, first-administrator
bootstrap — in [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md).

### Authentication

- bcrypt password hashing (cost 12) with a minimum-strength policy.
- Sessions are signed JWTs in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, **and** a
  row in `sessions`. Revoking the row kills the session immediately — a stolen token is
  useless after sign-out, a password change, a role change or deactivation. An absolute
  ceiling (`SESSION_ABSOLUTE_MAX_AGE`) is one that activity cannot extend.
- A failed sign-in cannot be distinguished from an unknown account, so the endpoint
  cannot be used to enumerate staff. Account state is checked *after* the password,
  for the same reason.
- Repeated failures lock the account temporarily; the login endpoint is rate limited per IP.
- Verification, reset and invitation tokens are SHA-256 hashed at rest, single-use,
  expiring, and claimed in one atomic UPDATE so two requests cannot both succeed.

### Authorization — three independent layers

1. **Route** — `protectedRoute()` resolves the session, checks the required permission,
   and rate limits. No handler runs without an authenticated caller.
2. **Service** — `assertPatientAccess()` runs on every patient-scoped operation. Access
   requires a real clinical relationship: attending clinician, care-team member,
   encounter provider, referral party, an explicit time-boxed grant, a diagnostic
   department with an order for that patient, or a ward nurse in the right department.
   Oversight roles see hospital-wide. Denials are audited.
3. **Database** — Row Level Security policies in
   [`0002_row_level_security.sql`](database/migrations/0002_row_level_security.sql)
   mirror the service rules clause for clause. They govern every non-owner role — a
   Supabase `anon` client, a BI tool, an analytics replica, a leaked read-only
   credential. Run `SELECT caresync_force_rls();` to enforce them against the
   application's own role too.

**Knowing a patient's identifier is never sufficient.** The visibility predicate is part
of the SQL, so an unauthorised record cannot appear in a result set — searching an exact
patient number you have no relationship to returns nothing.

`tests/integration/security.test.ts` attacks this from the outside: 37 cases that
each supply an identifier the caller is not entitled to. It found a real
vulnerability — three worklists (laboratory, radiology, pharmacy) applied no
visibility filter, so any account with `lab:read` could pass `?patientId=` and
read another patient's orders, name and hospital number. Reading the routes
would not have found it; they looked correct and each had a permission check.
[docs/SECURITY.md](docs/SECURITY.md) has the finding and both fixes.

### Data integrity

- `audit_logs` is append-only; a database trigger rejects `UPDATE` and `DELETE`.
- Referral transitions are validated in the service **and** by a database trigger.
- Clinical notes are versioned; the prior text is preserved in `clinical_note_versions`.
- A bed cannot hold two active admissions; a patient cannot have two open admissions.
- Prescribing is blocked when the medicine collides with a recorded allergy.

### Other controls

- Zod validation on the server for every mutating request — the client schema is the same module.
- All queries are parameterised through Drizzle. The one place an identifier is
  interpolated (sequence names) uses an allow-list and re-checks the result.
- Uploaded documents are never in a public bucket. Downloads go through an authenticated
  route that re-checks patient access and audits the read, so a shared URL grants nothing.
- A Content-Security-Policy built per request around a fresh nonce, with
  `strict-dynamic` — no `unsafe-inline` for scripts, because a policy containing
  it permits exactly the injection it exists to stop. Fonts are served from this
  origin rather than a third-party CDN, so no page view of a hospital system
  reports its reader's IP to another company. HSTS, `X-Frame-Options: DENY`,
  COOP/CORP, `X-Powered-By` removed, API responses `no-store`.
- JSON request logs with a request id, whose fields are **allow-listed** rather
  than deny-listed: no patient data can reach a log, because nobody can
  enumerate every field that might carry it. Logs say which request failed,
  never whose record it was — for that there is the audit trail.
- Every list query has a hard `LIMIT` at the service layer, so no caller can ask
  the database for an unbounded result set.
- No secret is exposed to the browser. Server modules carry a guard that throws if they
  are ever pulled into a client bundle.

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- A PostgreSQL 14+ database (local, Supabase, Neon, or Vercel Postgres)

### Setup

```bash
git clone https://github.com/Vedantsg23/caresync-hospital.git
cd caresync-hospital
npm install

cp .env.example .env
# Set DATABASE_URL, and generate a secret:
#   openssl rand -base64 48   →  AUTH_SECRET

npm run db:setup       # migrate, then load the demonstration hospital
npm run dev            # http://localhost:3000
```

Sign in with `doctor@caresync.demo` / `CareSync#2026`.

To stand up a **real** instance instead — empty database, no demo accounts, first
administrator created by you — follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
That is what `npm run vercel-build` does: migrations, then build, and no seed.

### Try the primary workflow

1. Sign in as **doctor@caresync.demo**.
2. Open **Rahul Mehta** (`PT-2026-00142`) from the dashboard or the patient registry.
3. Look through Overview, Timeline, Vitals, Clinical Notes, Investigations and Medications.
4. Choose **Refer to specialist** → Dr. Priya Mehta, Cardiology, priority *Urgent*,
   reason *"Persistent chest pain and abnormal ECG"*. The clinical context is drafted
   from the live record — review it and send.
5. Sign out, sign in as **specialist@caresync.demo**. The referral is in the inbox and
   the notification bell is lit.
6. Open it, **Accept referral**, then record the assessment, findings, recommendations,
   treatment plan and follow-up. **Complete referral**.
7. Sign back in as **doctor@caresync.demo**. Three notifications are waiting, the
   response is on the referral and on the patient's chart, and the timeline shows the
   whole journey.

---

## Demo accounts

**These exist only when you run `npm run db:seed`, which is a development
command.** A deployment has none of them: `npm run db:seed` refuses to run when
`NODE_ENV=production`, and the build command does not call it. Invented patients
must never sit in a database where a real one could be looked up, and a
shared-password account must never exist alongside real records.

Locally, every seeded account uses the password **`CareSync#2026`**.

| Role | Email | Person | Lands on |
| --- | --- | --- | --- |
| Senior doctor | `doctor@caresync.demo` | Dr. Aarav Sharma, General Medicine | `/dashboard` |
| Senior doctor (specialist) | `specialist@caresync.demo` | Dr. Priya Mehta, Cardiology | `/dashboard` |
| Junior doctor | `junior@caresync.demo` | Dr. Kavya Iyer, General Medicine | `/dashboard` |
| Nurse | `nurse@caresync.demo` | Sister Meera Nair | `/nursing` |
| Radiology | `radiology@caresync.demo` | Dr. Rohan Desai | `/radiology` |
| Pathology | `pathology@caresync.demo` | Dr. Ananya Bose | `/pathology` |
| Pharmacy | `pharmacy@caresync.demo` | Vikram Shah | `/pharmacy` |
| Hospital admin | `admin@caresync.demo` | Neha Kulkarni | `/admin` |
| HR admin | `hr@caresync.demo` | Sanjay Rao | `/admin/staff` |

> The one-click panel on the sign-in screen appears only when
> `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` is exactly `"true"` — anything else, including
> an empty value, leaves it off. That is the default.

Sign in as different roles to see authorization working: the HR administrator has no
clinical access at all, a nurse cannot prescribe, pathology cannot write a radiology
report, and none of them can read the audit trail.

---

## Environment variables

Only two have no working default. Everything else below is optional, and the
defaults are the safe choice: mail is recorded rather than sent, rate limits are
per-instance, the AI layer is the offline summariser, and no demo account
exists. Full annotated list in [`.env.example`](.env.example).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string (pooled) |
| `AUTH_SECRET` | ✅ | — | Session signing key, 32+ chars. `openssl rand -base64 48` |
| `DIRECT_URL` | | — | Non-pooled URL for migrations (Supabase / Neon) |
| `DB_POOL_MAX` | | `5` | Pooled connections per instance — small on purpose, see [Scaling](docs/SCALING.md) |
| `APP_ORIGIN` | | — | Public origin used in email links. Set it, or links point at localhost |
| `BOOTSTRAP_TOKEN` | | — | One-time token to create the first administrator, then remove |
| `SESSION_MAX_AGE` | | `28800` | Idle session lifetime in seconds (8 h, one shift) |
| `SESSION_ABSOLUTE_MAX_AGE` | | `604800` | Ceiling a session cannot be renewed past |
| `MAIL_DRIVER` | | `console` | `console` (records, does not send), `resend`, `smtp` |
| `MAIL_FROM` / `RESEND_API_KEY` / `SMTP_URL` | | — | Provider configuration |
| `REDIS_URL` / `REDIS_TOKEN` | | — | Upstash REST credentials. **Set these if you run more than one instance** |
| `LOG_LEVEL` | | `info` in prod | `debug` \| `info` \| `warn` \| `error` |
| `AI_PROVIDER` | | `heuristic` | `heuristic` (offline), `anthropic`, or `openai` |
| `AI_API_KEY` / `AI_MODEL` | | — | Required only for a hosted AI provider |
| `STORAGE_DRIVER` | | `database` | `database`, `local`, or `supabase` |
| `STORAGE_MAX_FILE_MB` | | `10` | Upload size limit |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | | — | Required for `STORAGE_DRIVER=supabase` |
| `RATE_LIMIT_LOGIN_PER_MIN` | | `10` | Sign-in attempts per IP per minute |
| `RATE_LIMIT_API_PER_MIN` | | `300` | API requests per user per route per minute |
| `RATE_LIMIT_REGISTER_PER_HOUR` | | `5` | Registrations per IP per hour |
| `RATE_LIMIT_RESET_PER_HOUR` | | `5` | Password-reset requests per IP per hour |

**Development only — never set these on a deployment holding real data:**
`SEED_DEMO_PASSWORD`, `SEED_FORCE`, `SEED_ALLOW_PRODUCTION`,
`NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS`, `NEXT_PUBLIC_DEMO_PASSWORD`. The demo-account
panel on the sign-in screen appears only when
`NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` is exactly `"true"`, and `npm run db:seed`
refuses to run when `NODE_ENV=production`.

> A variable set to an **empty string** is not the same as an unset one. Zod's
> `.default()` fires on `undefined`, not on `""`, so an empty value in a hosting
> dashboard used to defeat every default and take sign-in down with a `500`.
> `src/lib/env.ts` now strips empty values before validating — but set a
> variable properly or delete it; do not leave it blank.

`.env` is git-ignored. Never commit it. CI fails the build on credential-shaped
strings anywhere in the repository.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm run vercel-build` | Migrate, then build. **No seed** — a deployment starts empty |
| `npm start` | Serve the production build |
| `npm run db:migrate` | Apply every migration in `database/migrations` |
| `npm run db:seed` | Load the demonstration hospital. Refuses a non-empty database |
| `npm run db:seed:if-empty` | Same, but a no-op success if the database already has data. Not used by the production build |
| `npm run db:setup` | Migrate then seed |
| `npm run db:reset` | Drop and recreate the schema (development only) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:studio` | Drizzle Studio |
| `npm test` | Full test suite |
| `npm run test:unit` | Unit tests only (no database needed) |
| `npm run test:integration` | Integration tests (needs a test database) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck + lint + tests |

---

## Testing

**204 tests, all passing.**

```bash
npm run test:unit          # 56 tests, no database required
createdb caresync_test     # then point .env.test at it
npm run test:integration   # 148 tests against real PostgreSQL
```

Integration tests refuse to run unless `DATABASE_URL` names a test database, then migrate
and seed it themselves.

| Suite | Covers |
| --- | --- |
| `unit/permissions` | The permission matrix and separation of duties across all nine roles |
| `unit/referral-state-machine` | Every legal and illegal transition, terminal states |
| `unit/clinical-scoring` | Early-warning scoring, result flagging, the allergy interlock |
| `unit/validation` | Request schemas and the password policy |
| `unit/env` | Configuration validation: blank variables count as unset, offending names are reported, values never are |
| `integration/referral-workflow` | **The acceptance criterion** — the full doctor → specialist → doctor loop, 26 assertions |
| `integration/patient-access` | Who may open a record, search leakage, denial auditing, grants |
| `integration/clinical-workflows` | Vitals, notes, pathology, radiology, pharmacy, admissions, administration, AI, auth |
| `integration/aggregates` | Every dashboard figure compared against independently computed SQL |
| `integration/authentication` | Registration, verification, approval, rejection, invitation, reset, session rotation, bootstrap — 30 cases |
| `integration/security` | **Written as an attacker** — 37 cases that each supply an identifier the caller is not entitled to. This suite found a real IDOR; see [docs/SECURITY.md](docs/SECURITY.md) |

Load and query profiling are separate and are not part of `npm test`:
[docs/PERFORMANCE.md](docs/PERFORMANCE.md) and
[docs/LOAD_TESTING.md](docs/LOAD_TESTING.md).

---

## API reference

All endpoints are under `/api`. Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": { }, "meta": { } }

// failure
{ "success": false, "error": { "code": "PATIENT_NOT_FOUND", "message": "Patient could not be found." } }
```

Status codes: `400` malformed · `401` unauthenticated · `403` forbidden ·
`404` not found · `409` conflict or invalid transition · `422` validation ·
`429` rate limited · `500` internal.

Full request and response shapes: **[`docs/API.md`](docs/API.md)**.

<details>
<summary><strong>Endpoint summary (71 routes)</strong></summary>

| Method | Path | Permission |
| --- | --- | --- |
| `POST` | `/api/auth/login` | public |
| `POST` | `/api/auth/logout` | authenticated |
| `GET` | `/api/auth/me` | authenticated |
| `POST` | `/api/auth/change-password` | authenticated |
| `GET` | `/api/dashboard` | authenticated (role-aware) |
| `GET` | `/api/search` | `patient:search` |
| `GET` `POST` | `/api/patients` | `patient:search` / `patient:create` |
| `GET` `PATCH` | `/api/patients/:id` | `patient:read` / `patient:update` |
| `GET` | `/api/patients/:id/timeline` | `timeline:read` |
| `GET` `POST` | `/api/patients/:id/vitals` | `vitals:read` / `vitals:create` |
| `GET` | `/api/patients/:id/vitals/trend` | `vitals:read` |
| `GET` `POST` | `/api/patients/:id/notes` | `note:read` / `note:create` |
| `GET` `POST` | `/api/patients/:id/observations` | `observation:read` / `observation:create` |
| `GET` | `/api/patients/:id/labs` | `lab:read` |
| `GET` | `/api/patients/:id/radiology` | `radiology:read` |
| `GET` | `/api/patients/:id/investigations` | `lab:read` |
| `GET` | `/api/patients/:id/medications` | `medication:read` |
| `GET` | `/api/patients/:id/referrals` | `referral:read` |
| `GET` | `/api/patients/:id/documents` | `file:read` |
| `GET` `POST` | `/api/patients/:id/care-team` | `patient:read` / `careteam:manage` |
| `GET` | `/api/patients/:id/ai-summaries` | `ai:use` |
| `GET` `POST` | `/api/referrals` | `referral:read` / `referral:create` |
| `GET` | `/api/referrals/:id` | `referral:read` |
| `POST` | `/api/referrals/:id/accept` | `referral:respond` |
| `POST` | `/api/referrals/:id/decline` | `referral:respond` |
| `POST` | `/api/referrals/:id/request-information` | `referral:respond` |
| `POST` | `/api/referrals/:id/provide-information` | `referral:create` |
| `POST` | `/api/referrals/:id/respond` | `referral:respond` |
| `POST` | `/api/referrals/:id/complete` | `referral:respond` |
| `POST` | `/api/referrals/:id/cancel` | `referral:create` |
| `GET` | `/api/specialists` | `referral:read` |
| `GET` `POST` | `/api/admissions` | `admission:read` / `admission:create` |
| `POST` | `/api/admissions/:id/transfer` | `admission:transfer` |
| `POST` | `/api/admissions/:id/discharge` | `admission:discharge` |
| `GET` `POST` | `/api/wards` | `ward:read` / `ward:manage` |
| `GET` `POST` | `/api/beds` | `ward:read` / `ward:manage` |
| `PATCH` | `/api/beds/:id` | `ward:manage` |
| `GET` | `/api/departments` | authenticated |
| `GET` `POST` | `/api/labs/orders` | `lab:read` / `lab:order` |
| `POST` | `/api/labs/orders/:id/results` | `lab:result` |
| `GET` | `/api/labs/catalog` | `lab:read` |
| `GET` `POST` | `/api/radiology/studies` | `radiology:read` / `radiology:order` |
| `PATCH` | `/api/radiology/studies/:id` | `radiology:report` |
| `POST` | `/api/radiology/studies/:id/report` | `radiology:report` |
| `GET` `POST` | `/api/pharmacy/orders` | `medication:read` / `medication:prescribe` |
| `PATCH` | `/api/pharmacy/orders/:id` | `medication:update` |
| `POST` | `/api/pharmacy/orders/:id/administer` | `medication:administer` |
| `GET` | `/api/pharmacy/formulary` | `medication:read` |
| `GET` | `/api/notifications` | `notification:read` |
| `PATCH` | `/api/notifications/:id/read` | authenticated |
| `PATCH` | `/api/notifications/read-all` | authenticated |
| `GET` | `/api/realtime/stream` | authenticated (SSE) |
| `GET` `POST` | `/api/messages` | `message:read` / `message:send` |
| `GET` | `/api/messages/:id` | `message:read` |
| `POST` | `/api/messages/:id/messages` | `message:send` |
| `GET` | `/api/staff` | authenticated |
| `GET` | `/api/admin/dashboard` | `admin:dashboard` |
| `GET` `POST` | `/api/admin/staff` | `user:read` / `user:create` |
| `GET` `PATCH` | `/api/admin/staff/:id` | `user:read` / `user:update` |
| `POST` | `/api/admin/staff/:id/role` | `user:role_change` |
| `POST` | `/api/admin/staff/:id/status` | `user:update` |
| `POST` | `/api/admin/staff/:id/reset-password` | `user:update` |
| `GET` `POST` | `/api/admin/departments` | `department:manage` |
| `GET` | `/api/admin/roles` | `user:read` |
| `GET` | `/api/admin/audit` | `audit:read` |
| `POST` | `/api/ai/patient-summary` | `ai:use` |
| `GET` | `/api/ai/handover` | `ai:use` |
| `POST` | `/api/ai/summaries/:id/review` | `ai:use` |
| `POST` `GET` | `/api/files`, `/api/files/:id` | `file:upload` / `file:read` |
| `GET` | `/api/health` | public |

</details>

---

## Deployment

**Full guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).** The short version.

A deployment starts **empty**. No patients, no staff, no demo accounts, no shared
password. `npm run vercel-build` runs `npm run db:migrate && next build` —
migrations, then the build, and no seed. Migrations are additive and idempotent,
so redeploying is safe and repeated builds are no-ops for the database.

### 1. Configure

Two variables have no default: `DATABASE_URL` (pooled) and `AUTH_SECRET`
(`openssl rand -base64 48`). Set `APP_ORIGIN` so email links point at the right
host, `BOOTSTRAP_TOKEN` for step 2, a real `MAIL_DRIVER` if people are to receive
verification emails, and `REDIS_URL`/`REDIS_TOKEN` if you run more than one
instance. Leave every `SEED_*` and `NEXT_PUBLIC_DEMO_*` variable unset.

On Vercel, set the Build Command to `npm run vercel-build`. Note that Vercel
applies environment variables **at build time** — adding one changes nothing
until a new build runs, so after editing variables use
**Deployments → ⋯ → Redeploy**.

### 2. Create the first administrator

The database is empty, so there is nobody to sign in as and nobody to approve the
first registration. This breaks that circle exactly once:

```bash
curl -X POST https://your-host/api/auth/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<BOOTSTRAP_TOKEN>","email":"you@hospital.org",
       "fullName":"Your Name","password":"a password only you know"}'
```

The token is compared in constant time, and the endpoint **refuses to run once
any active administrator exists** — it cannot be used to add a second way in
later. Remove `BOOTSTRAP_TOKEN` afterwards.

Then sign in and create departments, wards and beds; staff and admissions
reference them.

### 3. Let people in

They register at `/register` and you approve at `/admin/registrations`, choosing
the role and department actually granted — which need not be what they asked
for. Or you invite them from `/admin/staff`, having already chosen the role, and
they set their own password.

### 4. Verify

```bash
curl https://your-host/api/health      # configuration and reachability
curl https://your-host/api/health/db   # pool, latency, migrations, drivers
```

`/api/health` names any offending **variables** — names only, never values — so a
misconfigured deployment says what is wrong instead of returning an opaque 500.
`/api/health/db` reports `migrationsApplied` (should match the file count in
`database/migrations/`), which limiter and mail driver are really in use, and
pool `total`/`idle`/`waiting`. **`waiting` above zero for any sustained period is
pool exhaustion**, and is the one number worth alerting on.

### Anywhere else

`npm ci && npm run db:migrate && npm run build && npm start` on any Node 20+
host. The only external dependency is PostgreSQL. The application is stateless —
sessions live in the database and realtime updates poll a database cursor — so
instances can be added, killed and replaced freely.

### Production checklist

- [ ] `AUTH_SECRET` is a fresh 32+ character random value, not the example
- [ ] No `SEED_*` or `NEXT_PUBLIC_DEMO_*` variable is set
- [ ] `BOOTSTRAP_TOKEN` removed after the first administrator exists
- [ ] `MAIL_DRIVER` is `resend` or `smtp`, and `APP_ORIGIN` is your real host
- [ ] `REDIS_URL` set if more than one instance runs
- [ ] `SELECT caresync_force_rls();` run, with the app on a dedicated non-owner role
- [ ] `STORAGE_DRIVER=supabase` (or S3) rather than storing documents in Postgres
- [ ] Backups and point-in-time recovery configured, and a restore actually tested

---

## Limitations

Stated plainly, because a healthcare tool should be honest about what it is not:

- **Not clinically validated.** A demonstration of a coordination workflow, not a medical device.
- **The early-warning score is illustrative.** It follows the shape of NEWS but is not a certified implementation.
- **No multi-factor authentication.** A stolen password is a full session. This is the largest security gap for a system holding clinical records.
- **No break-glass workflow.** Emergency access to a patient outside your care is a real clinical need; here it is simply refused. `patient_access_grants` is where it would be built.
- **No penetration test.** The security suite was written by the same person who wrote the code, which catches the mistakes that person can imagine. That is not the same as an adversary who does not share the assumptions.
- **Rate limiting is per-instance** unless `REDIS_URL` is set — on *n* instances it lets through roughly *n* times the configured limit. `/api/health/db` reports which store is live.
- **Load tested on one small shared machine.** ~35 req/s with the knee at ten concurrent sessions, on 2 vCPU running the app, the database and the load generator together. That shows concurrency degrades gracefully; it is **not** a capacity figure for any real deployment. See [docs/LOAD_TESTING.md](docs/LOAD_TESTING.md).
- **Tables that only grow.** `timeline_events`, `audit_logs` and `notifications` have no retention or partitioning. Fine at 1.2m rows; not forever.
- **Realtime is short-poll SSE.** Correct and portable, with roughly 2.5 s latency. Postgres `LISTEN/NOTIFY` or a hosted realtime service would be lower latency.
- **File storage defaults to the database.** Portable and fine for documents; use object storage for imaging.
- **No DICOM viewer.** Radiology holds orders, metadata and narrative reports. The schema separates metadata from bytes so a PACS integration only has to add a driver.
- **No billing module.** Deliberately out of scope, as in the product brief.
- **AI summaries are advisory.** The offline provider composes prose from structured facts; it never diagnoses, prescribes or writes to the chart.

---

## Licence and use

**All rights reserved.** This repository carries no open-source licence, so the default
applies: the code is published to be read, not reused. If you want to use any part of it,
ask first.

Please also read [NOTICE](NOTICE): this is a demonstration of a clinical workflow, not a
certified medical device. All patient data in this repository is invented. Never load real
patient information into a demonstration environment.
