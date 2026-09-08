# Scaling

What this architecture supports today, what breaks first, and what it would take
to go further. The measurements behind it are in `docs/PERFORMANCE.md` (query
behaviour at 50,000 patients) and `docs/LOAD_TESTING.md` (concurrency).

No number on this page is extrapolated from a smaller one.

## Where it stands

Measured on 2 vCPU with the application, the database and the load generator on
one host: **~35 requests per second, with the knee around ten concurrent
clinical sessions.** At that point the machine is 90% CPU-bound and PostgreSQL
is two thirds of it.

That is a statement about a small shared box, not about the ceiling of the
design. It is the only concurrency figure that has actually been measured, so it
is the only one quoted.

## What is already horizontal

Everything that serves a request is stateless. Sessions live in PostgreSQL, not
in process memory, so any instance can serve any request and an instance can be
killed mid-session without signing anybody out. Realtime updates are delivered
by server-sent events that poll a database cursor rather than an in-process
event bus, which is why they survive serverless and multiple instances.

So adding application instances works. Whether it *helps* is a separate
question, answered below.

## What breaks first, in order

### 1. Database CPU

This is the measured bottleneck, and it is worth saying because it is the
opposite of the usual assumption. At saturation:

```
postgres      64.3% of the machine
next-server   23.1% of the machine
```

The connection pool never queued (`waiting: 0`, ten to thirteen of twenty
connections idle). Adding application instances to this configuration would
add contention, not throughput. The database wants more CPU, or its own host.

### 2. Connection limits, not connection pooling

`DB_POOL_MAX` defaults to 5 per instance, deliberately small. On serverless the
constraint is not one process's appetite but the *product*: fifty concurrent
functions at twenty connections each is a thousand connections, and managed
PostgreSQL will refuse long before that.

- On Neon or Supabase, use the **pooled** connection string for
  `DATABASE_URL` and the direct one for `DIRECT_URL` (migrations only).
- Raising `DB_POOL_MAX` is the wrong first move on serverless. It is the right
  move on a small number of long-lived instances.

`/api/health/db` reports `total`, `idle`, `waiting` and `max`. **`waiting`
above zero for any sustained period is pool exhaustion** — the one number worth
alerting on.

### 3. The rate limiter

In-memory per instance unless `REDIS_URL` is set. On a single instance it is
exactly correct — verified: 340 requests against a 300/minute limit gave 300
through and 40 refused.

On *n* instances it lets through roughly *n* times the configured limit, because
each instance counts only the traffic it happens to receive. It does not fail
open and it does not fail closed; it dilutes. For sign-in throttling that
matters, so **a multi-instance deployment should set `REDIS_URL` and
`REDIS_TOKEN`** (Upstash REST credentials). The Redis driver falls back to
memory on error rather than refusing traffic, and `/api/health/db` reports
`"limiter": "memory"` or `"redis"` so this is checkable rather than assumed.

### 4. Exact pagination counts

Every paged list returns an exact `total` from a `count(*)` over the same
visibility predicate. That is honest and cheap now; it stops being cheap at a
few hundred thousand visible rows per user. The fix when it arrives is a planner
estimate, or dropping the exact total for "more pages".

### 5. Tables that only grow

`timeline_events`, `audit_logs`, `vital_signs` and `notifications` have no
retention policy. At the profiling volume — two years, 50,000 patients — the
database is 929 MB and correctly indexed. There is no partitioning, no archival
and no cold storage. A real hospital keeps records for decades, and at some
point `audit_logs` wants time-based partitioning and `notifications` wants a
retention window. Neither is written, and neither is urgent.

## What is not there

- **No caching layer.** Every request goes to the database. This is a deliberate
  starting point for clinical data, where a stale observation is a safety
  problem rather than a performance one, but read-through caching for reference
  data (departments, wards, the investigation catalogue) is safe and obvious
  when it is needed.
- **No read replicas.** Every read hits the primary.
- **No queue.** Email is sent inline through `sendQuietly`, which never lets a
  delivery failure break the operation that triggered it, but does make that
  operation wait. A queue is the right answer once mail volume is real.
- **No CDN caching of API responses**, and there should not be: every API
  response carries `Cache-Control: no-store`, because a cached patient record on
  a shared edge is precisely the wrong thing.

## Order of work, if load grew

1. **Give the database its own CPU.** It is the measured bottleneck; nothing
   else matters until this is done.
2. **Set `REDIS_URL`** before running more than one instance, so limits mean
   what they say.
3. **Measure again on the real deployment.** The numbers on this page were taken
   over loopback with everything on one host. Production adds a network round
   trip per query and serverless cold starts; the shape of the plans transfers,
   the milliseconds do not.
4. **Then** add application instances, having established that the database can
   feed them.
5. Cache reference data, and revisit exact counts, when profiling says so —
   not before.

## What this section is not

It is not a claim that the system handles any particular number of users. Load
testing was done on one small shared machine for 45 seconds at a time; that
establishes that concurrency degrades gracefully, that nothing errors, and that
the pool does not exhaust. It does not establish capacity.

Anyone who needs a capacity figure has to measure the real deployment, with its
own database, its own region and its own traffic shape.
