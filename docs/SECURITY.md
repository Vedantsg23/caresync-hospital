# Security model

What this system defends against, how, and where it is still weak. Account
creation, sessions and passwords are in `docs/AUTHENTICATION.md`; this file is
about everything after sign-in.

## The threat that matters

For a hospital record system the interesting attacker is not an anonymous
stranger. It is **an authenticated insider looking at a patient they have no
business looking at** — an ex-partner, a neighbour, a colleague, someone in the
news. That attacker already has a valid session and a real role. Nothing about
authentication stops them.

So the question every read path has to answer is not "is this person a
clinician?" but "is this person part of *this patient's* care?". Knowing a
patient's identifier must never be the same thing as being allowed to use it.

## Authorization, three independent layers

Each layer would be sufficient on a good day. They exist together because they
fail differently.

### 1. Route permission

Every API route is wrapped by `protectedRoute`, which resolves the session,
re-verifies it against the database, and checks a named permission from
`src/types/rbac.ts` before the handler runs. There is no code path that reaches
a service without an authenticated, permitted caller.

This layer answers "may a nurse prescribe?" — a question about the role, not
about the patient. It cannot answer the interesting question.

### 2. `assertPatientAccess`

`src/server/services/patient-access.service.ts` is the single authority on "may
this user see this patient?". A relationship must exist: attending doctor, care
team member, encounter provider, party to a referral, an explicit time-boxed
grant, a diagnostic department with an order for that patient, or a nurse on the
ward the patient is admitted to. Oversight roles pass; everyone else must have a
reason.

Denials are **audited**. An attempted breach is an event, not a silent 403.

For collections there is `patientVisibilityFilter`, which pushes the same rules
into the SQL, so unauthorised rows never enter a result set. Filtering in the UI
would be theatre.

### 3. PostgreSQL row-level security

Twenty policies in migration `0002_row_level_security.sql` mirror
`evaluatePatientAccess` clause for clause, via
`caresync_can_access_patient()`. A query that reaches the database through some
future code path that forgot the service layer still gets filtered.

## The IDOR audit

`tests/integration/security.test.ts` is written from the attacker's side: every
case supplies an identifier the caller is not entitled to and asserts a refusal.
Thirty-seven cases covering every patient-scoped read, every patient-scoped
write, collection enumeration, privilege escalation, audit of denials, and
malformed input.

It found a real vulnerability, which is the reason it exists.

**Three worklists — laboratory orders, radiology studies and medication
orders — applied no visibility filter at all.** Any account holding `lab:read`,
`radiology:read` or `medication:read` could pass `?patientId=<uuid>` and read
another patient's orders, and the response carries the patient's name and
hospital number. Reading the routes would not have found it; they looked
correct, and each had a permission check. Only an attack found it.

Two fixes went in:

- The three services now take the viewer. A query naming a specific patient is a
  direct object reference, so it is answered like every other patient read —
  `assertPatientAccess`, which denies and writes an audit row. The unscoped
  worklist is filtered so unauthorised rows never enter the result.
- `patientVisibilityFilter` now parenthesises itself. Its clauses are OR-ed, OR
  binds looser than AND, and passed unwrapped into `and(...)` the predicate
  `a AND b AND (x OR y)` silently degrades to `(a AND b AND x) OR y` — the
  filter stops filtering. Every existing call site happened to wrap it by hand.
  A correctness property must not depend on caller discipline.

## The audit trail

Append-only, enforced by a database trigger rather than by convention: `UPDATE`
and `DELETE` on `audit_logs` are refused by PostgreSQL itself. A test asserts
this by trying.

Every access decision, clinical write, referral transition and administrative
action records the actor, the patient, the action, the outcome and the address
it came from. Denials are recorded as `DENIED`, which is what makes the trail
useful for the insider case: the interesting row is often the one where somebody
was turned away.

## Transport and browser

Set per request in `src/middleware.ts` around a fresh nonce:

```
default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self' data:; connect-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none';
frame-src 'none'; upgrade-insecure-requests
```

A policy containing `'unsafe-inline'` for scripts permits exactly the injection
it exists to stop, so scripts are nonced and `'strict-dynamic'` lets Next's own
bootstrap load its chunks. `'unsafe-eval'` is development-only.

Fonts are served from this origin, from files committed to the repository. They
used to be a `<link>` to Google Fonts, which meant every page view of a hospital
system announced its reader's IP and referring URL to a third party — and forced
the policy to permit a stylesheet from somewhere other than `'self'`.

Alongside: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
denying camera, microphone, geolocation, payment and USB, HSTS for two years
with subdomains, `Cross-Origin-Opener-Policy` and
`Cross-Origin-Resource-Policy` at `same-origin`, and `Cache-Control: no-store`
on every API response.

## Input, output and injection

- Every request body and query string is parsed by a Zod schema shared with the
  client, so the browser and the server enforce the same rules and the server
  does not trust that the browser did.
- Every array input has a maximum length, so no request can ask the database for
  unbounded work.
- All SQL goes through Drizzle's parameter binding. The security suite includes
  a case that passes SQL as a patient number and asserts it is treated as data.
- Every list query has a hard `LIMIT` at the service layer
  (`src/server/core/pagination.ts`), so no caller can request an unbounded
  result set. An endpoint with no `LIMIT` is an availability defect: one request
  against a table that has grown for three years can hold a connection, spill to
  disk and serialise megabytes into a response.

## Logging

`src/server/core/logger.ts` writes one JSON object per line with a request id
minted at the edge and returned in `x-request-id`.

Fields are **allow-listed, not deny-listed**. Nobody can enumerate every field
that might identify a patient, and the first one somebody forgets ends up in a
log aggregator that is backed up, indexed and searchable by people with no
clinical relationship to that patient. Only the named safe fields are written;
anything else is dropped and the count of dropped fields appears in the line.

Logs say which request failed and where, never whose record it was. When you
need to know whose, that is the audit trail: access-controlled, append-only, and
admissible.

Configuration errors report variable **names**, never values — the names are
already public in `.env.example`, and without them a missing variable shows up
only as an opaque 500 on an unrelated endpoint.

## Secrets

Nothing sensitive is committed. `.env` is ignored; `.env.example` carries names
and safe defaults only. CI includes a secret scan that fails the build on
credential-shaped strings — connection URIs with a password, live API keys,
private key blocks.

`AUTH_SECRET` must be at least 32 characters and is validated at start-up.

## What is still weak

Stated plainly, because a security document that lists only strengths is
marketing.

- **No multi-factor authentication.** A stolen password is a full session. This
  is the most significant gap for a system holding clinical records.
- **No break-glass workflow.** Emergency access to a patient outside your care
  is a real clinical need, normally handled by letting a clinician through with
  a mandatory justification and a loud audit entry. Here they are simply
  refused. `patient_access_grants` is the right place to build it.
- **No field-level encryption.** Clinical data is protected by access control
  and by whatever the database provides at rest. An attacker with the database
  file and the ability to read it has the records.
- **The rate limiter is per-instance** unless `REDIS_URL` is set. On several
  instances it lets through roughly *n* times the configured limit. See
  `docs/SCALING.md`; `/api/health/db` reports which store is live.
- **No automated dependency-vulnerability gate.** CI runs `npm audit` but does
  not fail on it.
- **Sessions are not bound to a device or address.** A stolen cookie works from
  anywhere until it expires or is revoked.
- **No penetration test.** The security suite is written by the same person who
  wrote the code, which catches the mistakes that person can imagine. That is
  not the same as an adversary who does not share the assumptions.

None of these is hidden behind a configuration flag or a "future work" heading
somewhere else. They are the honest list.
