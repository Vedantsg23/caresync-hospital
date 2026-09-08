# Load testing

These are measurements, not a capacity claim. They were taken on one small
machine with everything running on it, and the section at the end says plainly
what they do and do not establish. Nothing here has been rounded in the
application's favour.

## What was run

`tests/load/api-load.js`, with k6 v0.54.0, against a production build
(`next start`) serving the profiling dataset from `docs/PERFORMANCE.md` — 50,027
patients, 30,027 admissions, 1.2m timeline events, 929 MB.

```bash
k6 run -e BASE_URL=http://127.0.0.1:3000 -e PASSWORD=… -e VUS=10 tests/load/api-load.js
```

Each virtual user runs a clinical session in a loop: dashboard, patient list,
open a patient record (header, timeline, then observations, notes and labs in
parallel), a search, and a set of observations written on roughly every tenth
iteration. Sessions are established once and shared across virtual users, and a
separate small scenario measures sign-in on its own — sign-in is bcrypt at cost
12, and twenty-five simultaneous sign-ins measure the key-derivation function
rather than the application.

## The machine

| | |
|---|---|
| CPU | 2 vCPU |
| Memory | 8 GB |
| PostgreSQL | 16.13, `shared_buffers` 128 MB, `work_mem` 4 MB |
| Application | `next start`, one Node process, `DB_POOL_MAX=20` |
| Topology | application, database **and load generator** all on this one host |
| Network | loopback |

That last row matters more than any of the others.

## Results

Throughput and latency, 45-second runs, no ramp:

| Virtual users | Throughput | Dashboard p95 | Patient list p95 | Patient record p95 | Search p95 | Timeline p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 20.5 req/s | 543 ms | 323 ms | 168 ms | 127 ms | 35 ms |
| 10 | 33.7 req/s | 989 ms | 560 ms | 334 ms | 418 ms | 90 ms |
| 15 | 36.1 req/s | 1.62 s | 854 ms | 622 ms | 540 ms | 416 ms |
| 25 | 35.0 req/s | 2.75 s | 1.48 s | 1.57 s | 963 ms | 1.14 s |

Medians at 10 virtual users: dashboard 284 ms, patient list 233 ms, patient
record 44 ms, timeline 22 ms, search 94 ms.

Sign-in, measured separately: p95 482 ms at 10 virtual users, 817 ms at 15. It
is bcrypt at cost 12 and it is meant to be expensive. It happens once per
session, not once per request.

**Errors: none.** The 0.2–0.3% of requests k6 counts as failed are `403`s on
writes, where the account is not on that patient's care team. That is the
authorization layer doing its job, and the script counts them separately from
real errors — `caresync_errors` is 0.00% across every run.

## Reading the table

Throughput stops rising after about 10 virtual users. Between 10 and 25 it sits
at 35–36 req/s while p95 latency climbs from 1 second to 2.75 — the shape of a
saturated system, where extra concurrency buys queueing rather than work.

The knee is around **10 concurrent sessions and ~34 req/s** on this hardware,
which is where latency is still comfortable. Beyond it, requests queue.

## Where the time goes

CPU-time deltas sampled over a 25-second window at 15 virtual users:

```
  postgres           32.1s cpu = 64.3% of machine
  next-server        11.5s cpu = 23.1% of machine
  k6                  0.8s cpu =  1.5% of machine
  TOTAL              45.0s cpu = 90.0% of machine
```

The machine is CPU-bound at 90%, and **PostgreSQL is two thirds of it**. The
connection pool is not the constraint: `/api/health/db` sampled during the run
reported `waiting: 0` with 10 to 13 of 20 connections idle throughout.

So on this configuration adding application instances would not help. The
database wants more CPU. That is a useful thing to know before provisioning
anything, and it is the opposite of the usual assumption.

Note also that k6 costs only 1.5% — the load generator is not distorting the
measurement, which is worth checking whenever the generator shares a host.

## Rate limiting, verified

Measured against a running server rather than asserted:

| | |
|---|---|
| 340 requests to one endpoint, limit 300/min | **300 served, 40 refused with `429`** and `retryAfterSeconds: 55` |
| 14 failed sign-ins from one IP, limit 10/min | **10 served, then `429`** |

The limiter is per-instance in-memory unless `REDIS_URL` is set. On a single
instance that is exactly correct. On *n* instances it lets through roughly *n*
times the configured limit, because each instance counts only its own traffic.
`/api/health/db` reports which store is live (`"limiter": "memory"` or
`"redis"`) so this is checkable rather than assumed. See `docs/SCALING.md`.

## What these numbers do not establish

They were taken with the application, the database and the load generator
sharing two vCPU over loopback. Every one of those is wrong in the direction of
making the numbers look different from production, and not all in the same
direction:

- **The database competing with the application for CPU** makes these numbers
  worse than a deployment with a separate database would be.
- **Loopback instead of a network** makes them better. Production runs on
  Vercel against Neon in another region: every query gains a round trip, and
  requests that issue several sequential queries gain several.
- **A single warm Node process** makes them better than serverless, where a
  cold function pays start-up, and worse than several warm ones.
- **A 45-second run** says nothing about connection churn, memory growth, cache
  eviction, autovacuum, or index bloat over days.

So: **this does not establish that the system supports any particular number of
users.** It establishes that at 50,000 patients the queries are correctly
indexed, that concurrency degrades gracefully rather than falling over, that
nothing errors under sustained load, that the pool does not exhaust, and that
the bottleneck on this hardware is database CPU.

Anyone who needs a real capacity figure has to measure the real deployment,
with its own database, its own region and its own traffic shape. Numbers from
this page should not be quoted as if they were that.
