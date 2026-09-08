# Performance

Every number on this page was measured on this application against a dataset
described below. Nothing here is estimated, extrapolated, or copied from a
benchmark of something else. Where a figure would not survive being moved to
different hardware, that is said so.

## The dataset

The demonstration seed is a few hundred rows. Profiling it tells you nothing:
PostgreSQL sequentially scans a table that fits in cache because doing so is
genuinely cheaper, and every plan looks fine. `scripts/profile-data.sql` builds
a hospital with two years of history instead:

| Table | Rows |
|---|---:|
| patients | 50,027 |
| admissions | 30,027 |
| timeline_events | 1,201,302 |
| vital_signs | 600,698 |
| audit_logs | 360,345 |
| clinical_notes | 240,258 |
| investigation_orders | 180,194 |
| notifications | 180,176 |
| medication_orders | 150,155 |
| referrals | 60,062 |
| **Database size** | **929 MB** |

Admissions are spread across the eight seeded doctors at roughly 3,700 each.

> The first version of that script got this wrong. Each lateral pick ordered by
> a hash of the *outer* row only, which gives every candidate the same sort key,
> so one consultant ended up attending 30,024 of the 30,027 admissions. The
> profile that produced was of a distribution that cannot exist, and it would
> have led to optimising a problem the application does not have. The fix is
> commented in the script; it is worth knowing about because the failure is
> silent and the output looks plausible.

## Method

```bash
createdb caresync_profile
DATABASE_URL=…/caresync_profile npm run db:migrate
DATABASE_URL=…/caresync_profile npm run db:seed          # reference data + staff
psql …/caresync_profile -f scripts/profile-data.sql      # ~2 minutes
```

With `auto_explain` loaded (`log_min_duration = 20ms`, `log_analyze`,
`log_buffers`) and `pg_stat_statements` enabled, a production build was driven
through a real signed-in session and every plan over 20ms captured. Timings
below are end-to-end HTTP, measured from the client, median of seven requests
after warm-up, against `next start` and PostgreSQL 16 on the same machine.

## Results

| Endpoint | Before | After | |
|---|---:|---:|---|
| `GET /api/dashboard` | 1836 ms | **69 ms** | 27× |
| `GET /api/patients?q=Sharma` | 1170 ms | **58 ms** | 20× |
| `GET /api/patients` | 947 ms | **97 ms** | 10× |
| `GET /api/referrals?box=incoming` | 120 ms | **14 ms** | 9× |
| `GET /api/pharmacy/orders` | 76 ms | **16 ms** | 5× |
| `GET /api/labs/orders` | 48 ms | **15 ms** | 3× |
| `GET /api/patients/:id` | 17 ms | 18 ms | — |
| `GET /api/patients/:id/timeline` | 14 ms | 15 ms | — |

Sign-in is 450–590 ms and is not in the table because it is bcrypt at cost 12,
which is the point of it. It is deliberate, it is per-session rather than
per-request, and making it faster would make it worse.

## What was actually wrong

### 1. JIT compilation cost more than the queries

The single largest component of the slowest endpoint was not a query. It was
PostgreSQL compiling one.

```
Timing: Generation 3.9 ms, Inlining 17.8 ms, Optimization 311.9 ms,
        Emission 183.1 ms, Total 516.7 ms
```

517 ms of LLVM, inside a request that took 614 ms, for a query returning twenty
rows. PostgreSQL enables JIT for any plan whose **estimated** cost exceeds
`jit_above_cost` (100000). Estimates against 50,000 patients clear that easily,
and past `jit_optimize_above_cost` the optimiser runs too. JIT pays for itself
on an analytical query that scans for seconds; on an OLTP request it is a
straight loss, and the worse the plan, the more likely the estimate is to
trigger it — so the mechanism intended to help slow queries was making the
slowest endpoint slower.

`src/server/db/client.ts` now issues `SET jit = off` on every pooled connection.
Per connection rather than per deployment, because managed PostgreSQL (Neon,
Supabase, RDS) ships with `jit = on` and does not always let you change it.

### 2. A trigram index that indexed an expression nothing queried

`patients_search_trgm` covers
`lower(first_name || ' ' || last_name || ' ' || patient_number)`.
The search filtered on three *different* expressions — `first||last`,
`last||first`, and `patient_number` alone. None matched, so the index was never
used and every search sequentially scanned all 50,027 patients: 109 ms for the
page, another 379 ms for the count.

The fix is in the query. `searchPatients` now matches the indexed expression
verbatim, one whitespace-separated token at a time, AND-ed together. This is
also better behaviour: `Sharma Priya` and `Priya PS-0004` now find the patient,
and neither did before.

One wrinkle worth recording. A correlated `EXISTS` on the other side of an `OR`
prevents PostgreSQL from using the trigram index for the whole predicate, so
folding the admission-number search into the same `OR` re-broke it. The
admission-number branch is now added only for tokens containing a digit;
admission numbers are structured (`ADM-000000123`) and a token with no digit in
it is a name.

### 3. The activity feed sorted 1.2 million rows on disk

```
Sort Method: external merge  Disk: 50752kB
Worker 0: external merge  Disk: 39808kB
Worker 1: external merge  Disk: 59472kB
Parallel Seq Scan on timeline_events  rows=400434 (×3)
```

Twelve rows were wanted. With no index on the ordering column, every dashboard
load read the whole timeline and spilled ~150 MB to disk to sort it. An index
on `timeline_events (occurred_at DESC)` makes it an ordered scan that stops.

### 4. Counting a caseload by scanning the hospital

The clinician KPI tile was `count(*) FILTER (…) FROM patients` with three
correlated `EXISTS` subqueries — 150,081 index probes across 50,027 patients, at
a microsecond each, to describe a caseload of a few hundred people. 305 ms in
one statement.

Rewritten as a CTE that builds the caseload from the two indexes that define it
and joins the patients back. Same numbers, work proportional to the caseload
rather than to the hospital.

### 5. Ordering by an expression no index could satisfy

The referral inbox sorted by `CASE priority WHEN 'EMERGENCY' THEN 2 …`, so
answering it meant reading every referral addressed to the specialist — 9,901
rows at roughly 845 bytes each, clinical summaries included — to return fifty.

`referral_priority` is declared `ROUTINE, URGENT, EMERGENCY`, so ordering by the
enum descending *is* "emergencies first". Ordering by the column instead of the
expression lets an index return the rows already sorted: 120 ms → 14 ms.

## Indexes added

All in `database/migrations/0005_performance_indexes.sql`, each with the plan
that justified it in the comment above it. Additive and idempotent; no table is
rewritten.

`timeline_events (occurred_at DESC)` ·
`care_team_members (user_id, patient_id) WHERE removed_at IS NULL` ·
`admissions (attending_doctor_id, patient_id)` ·
`encounters (provider_id, patient_id)` ·
`admissions USING gin (lower(admission_number) gin_trgm_ops)` ·
`investigation_orders (status, ordered_at DESC)` ·
`medication_orders (status, created_at DESC)` ·
`radiology_studies (status, requested_at DESC)` ·
`referrals (specialist_doctor_id, priority DESC, created_at DESC)` ·
`referrals (referring_doctor_id, priority DESC, created_at DESC)` ·
`audit_logs (created_at DESC)`

## What is still slow, and why

**`GET /api/patients` at ~97 ms.** For a consultant whose visibility resolves to
11,643 of the 50,027 patients, the predicate is a five-branch `OR` across
admissions, care team, encounters, referrals and explicit grants. PostgreSQL
evaluates it as hashed subplans and scans the patient table once — about 36 ms
of the total. No single index fixes a five-way `OR`; the ways to improve it are
a materialised caseload table kept current by trigger, or narrowing the default
list to admitted patients. Neither has been done, because 97 ms is acceptable
and both trade correctness risk for latency the application does not need.

**Pagination counts.** `total` is an exact `count(*)` over the same predicate.
Exact counts stop being free at a few hundred thousand visible rows. When that
becomes real the answer is an estimate from the planner, or dropping the exact
total in favour of "more pages".

## What these numbers do not tell you

They are single-machine, warm-cache, one-request-at-a-time measurements with the
application and the database on the same host and no network between them. They
say the queries are correctly indexed. They do **not** say what the system does
under concurrency, and they are not a capacity figure — for concurrency see
`docs/LOAD_TESTING.md`, which is measured separately and has its own limits.

Production runs on Vercel's serverless functions against a Neon database in
another region. Every one of these timings gains a network round trip, and a
cold function gains its start-up. The shape of the plans is what transfers; the
milliseconds are not.
