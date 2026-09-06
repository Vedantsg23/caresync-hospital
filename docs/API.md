# CareSync Hospital — API Reference

**Base URL** `/api` · **Content type** `application/json` (except file upload) · **Auth** httpOnly session cookie

Every endpoint below is implemented in `src/app/api/**/route.ts` and enforced by the
same three-layer authorization model described in the [README](../README.md#security-model).
This document is generated from the route handlers, the permission matrix in
`src/types/rbac.ts` and the Zod schemas in `src/server/validators/index.ts`, so it
does not drift from the code.

---

## Contents

1. [Conventions](#1-conventions)
2. [Errors](#2-errors)
3. [Authentication](#3-authentication)
4. [Authorization](#4-authorization)
5. [Rate limiting](#5-rate-limiting)
6. [Endpoints](#6-endpoints)
   - [Auth](#auth) · [Dashboard & search](#dashboard--search) · [Patients](#patients)
   - [Referrals](#referrals) · [Clinical](#clinical-notes-vitals-observations) · [Laboratory](#laboratory)
   - [Radiology](#radiology) · [Pharmacy](#pharmacy) · [Admissions, wards & beds](#admissions-wards--beds)
   - [Notifications & realtime](#notifications--realtime) · [Messaging](#messaging) · [Files](#files)
   - [AI](#ai-advisory-only) · [Administration](#administration) · [Reference & health](#reference--health)
7. [The referral workflow, end to end](#7-the-referral-workflow-end-to-end)
8. [Enumerations](#8-enumerations)

---

## 1. Conventions

Every JSON response uses one envelope, produced by `src/server/core/api.ts`.

**Success**

```json
{
  "success": true,
  "data": { "...": "..." },
  "meta": { "page": 1, "pageSize": 20, "total": 87, "totalPages": 5 }
}
```

`meta` is present only on paginated collections.

**Failure**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The submitted data is not valid.",
    "details": [{ "field": "clinicalSummary", "message": "Clinical summary is required" }]
  }
}
```

Other conventions:

| Rule | Detail |
| --- | --- |
| Identifiers | UUID v4 in path segments and bodies. Human-facing numbers (`PT-2026-00142`, `REF-2026-00009`) are display fields, never path parameters. |
| Timestamps | ISO 8601 with timezone, UTC on the wire (`2026-09-06T09:12:44.118Z`). |
| Dates | `YYYY-MM-DD` for date-only fields (`dateOfBirth`, `startDate`). Coerced server-side. |
| Enumerations | `SCREAMING_SNAKE_CASE` strings, listed in [§8](#8-enumerations). |
| Empty values | `null`, never omitted, on nullable response fields. |
| Caching | Every `/api/*` response carries `Cache-Control: no-store` (set in `next.config.ts`). |
| Method mismatch | An unsupported method on an existing path returns `405` from the framework. |

---

## 2. Errors

`src/server/core/errors.ts` maps a stable machine-readable `code` to an HTTP status.
Clients should branch on `error.code`, not on the message.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No session cookie, or the cookie's session row is revoked or expired. |
| `INVALID_CREDENTIALS` | 401 | Email/password pair rejected. Deliberately identical for unknown email and wrong password. |
| `SESSION_EXPIRED` | 401 | The JWT verified but the backing session has lapsed. |
| `FORBIDDEN` | 403 | Authenticated, but the action is not permitted. |
| `INSUFFICIENT_PERMISSION` | 403 | The caller's role lacks the permission the route requires. |
| `PATIENT_ACCESS_DENIED` | 403 | The caller holds the permission but has no relationship to *this* patient. Audited. |
| `NOT_FOUND` | 404 | Generic missing resource. |
| `PATIENT_NOT_FOUND` | 404 | Patient id does not exist. Returned instead of 403 so a missing record is not confused with a blocked one. |
| `REFERRAL_NOT_FOUND` | 404 | Referral id does not exist, or the caller is not a party to it. |
| `USER_NOT_FOUND` | 404 | Staff id does not exist. |
| `CONFLICT` | 409 | Generic state conflict, including a foreign key that points nowhere. |
| `DUPLICATE_RESOURCE` | 409 | Unique constraint violated (duplicate email, duplicate ward code, second open admission for one patient). |
| `INVALID_STATE_TRANSITION` | 409 | A referral, order or study was pushed into a state its state machine forbids. Raised by the service *and* by a database trigger. |
| `BED_UNAVAILABLE` | 409 | The requested bed is occupied, reserved or being cleaned. |
| `VALIDATION_ERROR` | 422 | Zod rejected the body or query string. `details` is an array of `{ field, message }`. |
| `RATE_LIMITED` | 429 | Too many requests. `details.retryAfterSeconds` says how long to wait. |
| `ACCOUNT_LOCKED` | 429 | Too many failed sign-ins for this account. |
| `INTERNAL_ERROR` | 500 | Unhandled server fault. Logged server-side; no internals are returned. |
| `CONFIGURATION_ERROR` | 503 | The deployment is missing required environment variables. `details.variables` names them; values are never returned. |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable (only `/api/health` returns this deliberately). |

Postgres errors are translated rather than leaked: `23505` → `DUPLICATE_RESOURCE`,
`23503` → `CONFLICT`, and the referral transition check constraint → `INVALID_STATE_TRANSITION`.

---

## 3. Authentication

Sign-in issues an HS256 JWT **and** writes a `sessions` row. Both must be valid on every
request, so revoking a session takes effect immediately rather than at token expiry.

The token travels in a cookie the browser never exposes to JavaScript:

```
Set-Cookie: caresync_session=<jwt>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200
```

There is no `Authorization: Bearer` path — a bearer token in a browser app is an
XSS exfiltration target, and the cookie is what the middleware, route handlers and
server components all read.

**Calling the API from a script**

```bash
# 1. sign in, keeping the cookie jar
curl -c jar.txt -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"doctor@caresync.demo","password":"CareSync#2026"}'

# 2. every subsequent call reuses it
curl -b jar.txt http://localhost:3000/api/referrals?box=incoming
```

Cookies are `SameSite=Lax`, so a cross-site `POST` cannot carry one — that is the
CSRF defence for state-changing routes.

---

## 4. Authorization

Three independent layers must all agree before data is returned.

**Layer 1 — route permission.** `protectedRoute(handler, { permission })` in
`src/server/core/route.ts` resolves the session, loads the caller and asserts the
permission before the handler body runs. Failure → `403 INSUFFICIENT_PERMISSION`.

**Layer 2 — patient-level access.** Holding `patient:read` does not grant access to
*every* patient. `assertPatientAccess()` (`src/server/services/patient-access.service.ts`)
evaluates the caller's relationship to that specific record and returns one of:

| Reason | Granted to |
| --- | --- |
| `OVERSIGHT_ROLE` | `SUPER_ADMIN`, `HOSPITAL_ADMIN` — hospital-wide. |
| `ATTENDING_DOCTOR` | The consultant on the patient's open admission. |
| `CARE_TEAM` | Anyone on the patient's active care team. |
| `ENCOUNTER_PROVIDER` | A clinician who has an encounter with the patient. |
| `REFERRAL_PARTY` | The referring doctor or the specialist on a referral for that patient. |
| `EXPLICIT_GRANT` | A time-boxed grant in `patient_access_grants` (break-glass, with a justification). |
| `DIAGNOSTIC_ORDER` | Pathology, radiology or pharmacy — only where an order actually reached their department. |
| `WARD_NURSE` | A nurse, only for patients admitted to their own department. |
| `DENIED` | Everyone else. |

A denial returns `403 PATIENT_ACCESS_DENIED` **and writes an audit row** with the
caller, the patient, the IP and the user agent.

The same rules apply to collections: `patientVisibilityFilter()` injects the predicate
into the SQL, so search cannot be used to enumerate records. Searching an exact patient
number you are not entitled to returns `total: 0`, not a 403 — the absence of a leak
is itself the answer.

**Layer 3 — row-level security.** `database/migrations/0002_row_level_security.sql`
mirrors the TypeScript rules as Postgres policies via `caresync_can_access_patient()`.
A direct `psql` session under the application role sees exactly what the API would return.

---

## 5. Rate limiting

| Scope | Default | Key | Configure |
| --- | --- | --- | --- |
| Sign-in | 10 / minute | client IP | `RATE_LIMIT_LOGIN_PER_MIN` |
| Authenticated API | 300 / minute | user id + path | `RATE_LIMIT_API_PER_MIN` |
| Notifications polling | 600 / minute | user id + path | route override |
| File upload | 60 / minute | user id + path | route override |
| AI endpoints | 30 / minute | user id + path | route override |
| Password reset | 20 / minute | user id + path | route override |

Exceeding a limit returns `429` with `details.retryAfterSeconds`.

---

## 6. Endpoints

The **Permission** column names the constant from `src/types/rbac.ts` that
`protectedRoute` enforces. *Patient scope* in the notes column means
`assertPatientAccess()` also runs.

### Auth

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | *public* | Rate limited per IP. Sets the session cookie. |
| `POST` | `/api/auth/logout` | authenticated | Revokes the session row and clears the cookie. |
| `GET` | `/api/auth/me` | authenticated | Identity, role, department and the caller's full permission list. |
| `POST` | `/api/auth/change-password` | authenticated | Requires the current password. Revokes other sessions. |

<details>
<summary><code>POST /api/auth/login</code></summary>

**Body** — `loginSchema`

| Field | Type | Rules |
| --- | --- | --- |
| `email` | string | Valid email. Trimmed, lower-cased. |
| `password` | string | 1–200 characters. |

**200**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "0f9c…", "email": "doctor@caresync.demo",
      "fullName": "Dr. Aarav Sharma", "role": "SENIOR_DOCTOR",
      "departmentName": "General Medicine", "designation": "Consultant Physician",
      "specialization": "Internal Medicine", "acceptsReferrals": true,
      "permissions": ["patient:read", "referral:create", "…"]
    },
    "redirectTo": "/dashboard"
  }
}
```

`redirectTo` comes from `ROLE_HOME` — a nurse lands on `/nursing`, pathology on
`/pathology`, an administrator on `/admin`.

**401** `INVALID_CREDENTIALS` — identical response for an unknown email and a wrong
password, so the endpoint cannot be used to enumerate staff accounts.
**429** `RATE_LIMITED` after 10 attempts from one IP in a minute.

</details>

<details>
<summary><code>POST /api/auth/change-password</code></summary>

**Body** — `changePasswordSchema`: `currentPassword` (string), `newPassword` (10–200 characters).
**200** `{ "success": true, "data": { "changed": true } }`. All other sessions for the
user are revoked, so a stolen cookie dies with the password change.

</details>

### Dashboard & search

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/dashboard` | authenticated | Role-shaped payload: doctor, nurse, department worklist or hospital overview. |
| `GET` | `/api/search` | `PATIENT_SEARCH` | Cross-entity search, filtered to what the caller may see. |

<details>
<summary><code>GET /api/dashboard</code></summary>

Returns a different shape per role, discriminated by `kind`:

- `kind: "doctor"` — `kpis` (`patientsUnderCare`, `pendingReferrals`, `criticalResults`, `todaysAdmissions`), `criticalPatients[]`, `incomingReferrals[]`, `recentActivity[]`
- `kind: "nurse"` — assigned ward, patients due observations, medications due, escalations
- `kind: "department"` — pending worklist, completed today, turnaround, critical queue
- `kind: "admin"` — hospital KPIs (beds by status, active staff, total patients) and `departmentActivity[]`

Every count is computed in SQL against the caller's visible set; nothing is estimated
client-side. `tests/integration/aggregates.test.ts` compares each figure to independently
computed ground truth.

</details>

<details>
<summary><code>GET /api/search?q=…</code></summary>

**Query** — `searchQuerySchema`: `q` (1–120 characters, required).
Searches patients, staff and referrals in one pass using a trigram index, and applies
the patient visibility filter to the patient bucket.

```json
{ "success": true, "data": {
  "patients": [{ "id": "…", "patientNumber": "PT-2026-00142", "fullName": "Rahul Mehta", "…": "…" }],
  "staff":    [{ "id": "…", "fullName": "Dr. Priya Mehta", "role": "SENIOR_DOCTOR", "…": "…" }],
  "referrals":[{ "id": "…", "referralNumber": "REF-2026-00009", "status": "COMPLETED", "…": "…" }]
} }
```

</details>

### Patients

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/patients` | `PATIENT_SEARCH` | Paginated. Visibility-filtered. |
| `POST` | `/api/patients` | `PATIENT_CREATE` | Allocates the next `PT-YYYY-NNNNN`. |
| `GET` | `/api/patients/{id}` | `PATIENT_READ` | Patient scope. The connected header. |
| `PATCH` | `/api/patients/{id}` | `PATIENT_UPDATE` | Patient scope. Partial update. |
| `GET` | `/api/patients/{id}/timeline` | `TIMELINE_READ` | Patient scope. Cursor paginated. |
| `GET` | `/api/patients/{id}/notes` | `NOTE_READ` | Patient scope. |
| `POST` | `/api/patients/{id}/notes` | `NOTE_CREATE` | Patient scope. Versioned on amendment. |
| `GET` | `/api/patients/{id}/vitals` | `VITALS_READ` | Patient scope. |
| `POST` | `/api/patients/{id}/vitals` | `VITALS_CREATE` | Patient scope. Scores and may escalate. |
| `GET` | `/api/patients/{id}/vitals/trend` | `VITALS_READ` | Patient scope. Series for charting. |
| `GET` | `/api/patients/{id}/observations` | `OBSERVATION_READ` | Patient scope. |
| `POST` | `/api/patients/{id}/observations` | `OBSERVATION_CREATE` | Patient scope. |
| `GET` | `/api/patients/{id}/labs` | `LAB_READ` | Patient scope. |
| `GET` | `/api/patients/{id}/investigations` | `LAB_READ` | Patient scope. Orders with result counts. |
| `GET` | `/api/patients/{id}/radiology` | `RADIOLOGY_READ` | Patient scope. |
| `GET` | `/api/patients/{id}/medications` | `MEDICATION_READ` | Patient scope. |
| `GET` | `/api/patients/{id}/referrals` | `REFERRAL_READ` | Patient scope. |
| `GET` | `/api/patients/{id}/documents` | `FILE_READ` | Patient scope. Metadata only. |
| `GET` | `/api/patients/{id}/care-team` | `PATIENT_READ` | Patient scope. |
| `POST` | `/api/patients/{id}/care-team` | `CARETEAM_MANAGE` | Patient scope. Adding a member grants that member access. |
| `GET` | `/api/patients/{id}/ai-summaries` | `AI_USE` | Patient scope. Previously generated advisory summaries. |

<details>
<summary><code>GET /api/patients</code></summary>

**Query** — `patientSearchSchema`

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `q` | string | — | Name or patient number, ≤ 120 characters. |
| `status` | enum | — | `STABLE` · `NEEDS_ATTENTION` · `CRITICAL` |
| `wardId` | uuid | — | Restrict to one ward. |
| `mineOnly` | `"true"` \| `"false"` | `false` | Only the caller's own caseload. |
| `page` | int | `1` | ≥ 1 |
| `pageSize` | int | `20` | 1–100 |

**200** — `data` is `PatientListItemDto[]`, `meta` carries `{ page, pageSize, total, totalPages }`.
`total` counts only records the caller may see.

</details>

<details>
<summary><code>POST /api/patients</code></summary>

**Body** — `createPatientSchema`

| Field | Type | Rules |
| --- | --- | --- |
| `firstName`, `lastName` | string | Required, ≤ 120. |
| `dateOfBirth` | date | Required. Not in the future, after 1900-01-01. |
| `gender` | enum | `MALE` · `FEMALE` · `OTHER` · `UNKNOWN` |
| `bloodGroup` | enum | Optional. See [§8](#8-enumerations). |
| `phone`, `email`, `addressLine`, `city`, `state`, `postalCode` | string | Optional. |
| `allergies` | string[] | Optional, ≤ 40 entries. Drives the prescribing interlock. |
| `chronicConditions` | string[] | Optional, ≤ 40 entries. |
| `emergencyContact` | object | Optional: `name`, `relationship`, `phone`, optional `email`. |

**201** — the created patient including its allocated `patientNumber`.

</details>

<details>
<summary><code>GET /api/patients/{id}</code> — the connected view</summary>

One request assembles what a clinician needs at the bedside, which is the whole point
of the tagline:

```json
{ "success": true, "data": {
  "id": "…", "patientNumber": "PT-2026-00142", "fullName": "Rahul Mehta",
  "age": 54, "gender": "MALE", "bloodGroup": "B_POSITIVE",
  "status": "CRITICAL",
  "allergies": ["Penicillin", "Sulfa drugs"],
  "chronicConditions": ["Type 2 diabetes", "Hypertension"],
  "admission": { "admissionNumber": "ADM-2026-00212", "wardName": "Intensive Care Unit",
                 "bedCode": "ICU-04", "departmentName": "General Medicine",
                 "attendingDoctorName": "Dr. Aarav Sharma", "admissionDate": "2026-09-02T…" },
  "careTeam": [{ "name": "Dr. Aarav Sharma", "role": "ATTENDING", "…": "…" }],
  "latestVitals": { "bloodPressureSystolic": 148, "heartRate": 96, "spo2": 94, "score": 5, "…": "…" },
  "activeMedications": [{ "medicineName": "Enoxaparin", "dose": "40 mg", "route": "SUBCUTANEOUS", "…": "…" }],
  "openReferrals": 1, "pendingResults": 2
} }
```

**403** `PATIENT_ACCESS_DENIED` if the caller has no relationship to the record — and
the attempt is written to `audit_logs`.
**404** `PATIENT_NOT_FOUND` if the id does not exist.

</details>

<details>
<summary><code>GET /api/patients/{id}/timeline</code></summary>

**Query** — `timelineQuerySchema`: `limit` (1–100), `cursor` (opaque, from the previous
page's `meta.nextCursor`), `types` (comma-separated `TimelineEventType` filter).

The timeline is the union of admissions, notes, vitals, orders, results, prescriptions,
administrations and every referral state change, newest first. Referral events carry a
`referenceId` so the client can deep-link into the referral detail.

</details>

<details>
<summary><code>POST /api/patients/{id}/vitals</code></summary>

**Body** — `vitalsSchema`. At least one measurement is required; `notes` alone is rejected.

| Field | Type | Range |
| --- | --- | --- |
| `temperatureC` | number | 25–45 |
| `heartRate` | int | 10–300 |
| `bloodPressureSystolic` | int | 40–300, must exceed diastolic |
| `bloodPressureDiastolic` | int | 20–220 |
| `spo2` | int | 30–100 |
| `respiratoryRate` | int | 2–80 |
| `painScore` | int | 0–10 |
| `bloodGlucose` | number | 0.5–60 |
| `notes` | string | ≤ 1000 |

**201** — the recorded set plus a NEWS-style `score` and `severity`. A score in the
escalation band writes a timeline event and notifies the attending doctor.

</details>

<details>
<summary><code>POST /api/patients/{id}/notes</code></summary>

**Body** — `createNoteSchema`: `noteType` (`ADMISSION` · `PROGRESS` · `CONSULTATION` ·
`NURSING` · `SPECIALIST` · `DISCHARGE`), `title` (≤ 200), `content` (≤ 20 000),
optional `encounterId`.

Amending a note never overwrites it: the previous text is copied into
`clinical_note_versions` with the author and an optional `changeNote`, so the chart
keeps a defensible history.

</details>

<details>
<summary><code>POST /api/patients/{id}/care-team</code></summary>

**Body** — `careTeamSchema`: `userId` (uuid), `role` (`ATTENDING` · `CONSULTING` ·
`SPECIALIST` · `RESIDENT` · `PRIMARY_NURSE` · `NURSE`).

Adding someone to the care team is what grants them `CARE_TEAM` access to the record —
membership *is* the authorization, so there is no separate "share" action to forget.

</details>

### Referrals

The differentiating workflow. Every transition is enforced twice: in
`referral.service.ts` and by the `caresync_referral_transition()` database trigger.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/referrals` | `REFERRAL_READ` | Inbox/outbox. |
| `POST` | `/api/referrals` | `REFERRAL_CREATE` | Patient scope. Allocates `REF-YYYY-NNNNN`. |
| `GET` | `/api/referrals/{id}` | `REFERRAL_READ` | Full packet plus response thread. |
| `POST` | `/api/referrals/{id}/accept` | `REFERRAL_RESPOND` | Specialist only. Grants access, joins the care team. |
| `POST` | `/api/referrals/{id}/decline` | `REFERRAL_RESPOND` | Specialist only. Reason required. |
| `POST` | `/api/referrals/{id}/request-information` | `REFERRAL_RESPOND` | Specialist asks a question. |
| `POST` | `/api/referrals/{id}/provide-information` | `REFERRAL_CREATE` | Referrer answers. |
| `POST` | `/api/referrals/{id}/respond` | `REFERRAL_RESPOND` | The clinical opinion. Also writes a `SPECIALIST` note. |
| `POST` | `/api/referrals/{id}/complete` | `REFERRAL_RESPOND` | Closes the loop. |
| `POST` | `/api/referrals/{id}/cancel` | `REFERRAL_CREATE` | Referrer withdraws. |
| `GET` | `/api/specialists` | `REFERRAL_READ` | Doctors accepting referrals, for the picker. |

**State machine**

```
PENDING ──accept──────────────► ACCEPTED ──respond──► IN_PROGRESS ──complete──► COMPLETED
   │                                │                       ▲
   ├──decline───────► DECLINED      └──request-information──►│
   ├──cancel────────► CANCELLED                REQUESTED_INFORMATION
   └──request-information──► REQUESTED_INFORMATION ──provide-information──► PENDING
```

`COMPLETED`, `DECLINED` and `CANCELLED` are terminal. Any other transition is
`409 INVALID_STATE_TRANSITION`, whether it arrives through the API or through raw SQL.

<details>
<summary><code>GET /api/referrals</code></summary>

**Query** — `referralListSchema`

| Field | Type | Rules |
| --- | --- | --- |
| `box` | enum | `incoming` (to me) · `outgoing` (from me) · `all` |
| `status` | string | Comma-separated `ReferralStatus` values. |
| `patientId` | uuid | Restrict to one patient. |
| `priority` | enum | `ROUTINE` · `URGENT` · `EMERGENCY` |
| `limit` | int | 1–200 |

Results are ordered by priority then age, so an `EMERGENCY` referral is never buried
under routine ones.

</details>

<details>
<summary><code>POST /api/referrals</code></summary>

**Body** — `createReferralSchema`

| Field | Type | Rules |
| --- | --- | --- |
| `patientId` | uuid | Required. Caller must have access to the patient. |
| `specialistDoctorId` | uuid | Required. Must be a doctor with `acceptsReferrals`. |
| `toDepartmentId` | uuid | Optional. Defaults to the specialist's department. |
| `reason` | string | Required, ≤ 500. |
| `clinicalSummary` | string | Required, ≤ 8000. |
| `symptoms`, `relevantHistory`, `relevantInvestigations`, `currentMedications` | string | Optional, ≤ 4000 each. |
| `priority` | enum | `ROUTINE` (default) · `URGENT` · `EMERGENCY` |
| `encounterId` | uuid | Optional link to the encounter that prompted it. |

**201** — the referral with its `referralNumber`. In one transaction the service also:
grants the specialist scoped access to the patient, writes a `REFERRAL_CREATED` timeline
event, notifies the specialist (which reaches an open SSE stream within ~2.5 s) and
records an audit row.

**403** `PATIENT_ACCESS_DENIED` if the referring doctor has no relationship to the patient —
you cannot refer a patient you are not treating.

</details>

<details>
<summary><code>POST /api/referrals/{id}/respond</code></summary>

**Body** — `referralResponseSchema`. Every clinical field is mandatory: a specialist
opinion with a blank plan is worse than none.

| Field | Type | Rules |
| --- | --- | --- |
| `assessment` | string | Required, ≤ 8000. |
| `findings` | string | Required, ≤ 8000. |
| `recommendations` | string | Required, ≤ 8000. |
| `treatmentPlan` | string | Required, ≤ 8000. |
| `followUp` | string | Optional, ≤ 4000. |

**201** — the response. Side effects, all in one transaction: status → `IN_PROGRESS`,
a `SPECIALIST` clinical note is written onto the patient's chart so the opinion lives
in the record and not only in the referral, a `REFERRAL_RESPONSE` timeline event is
added, the referring doctor is notified, and an audit row is written.

**409** `INVALID_STATE_TRANSITION` if the referral is not `ACCEPTED` or `IN_PROGRESS`.
**403** `FORBIDDEN` if the caller is not the assigned specialist.

</details>

<details>
<summary>Simple referral actions</summary>

| Endpoint | Body | From → To |
| --- | --- | --- |
| `accept` | none | `PENDING` → `ACCEPTED` |
| `decline` | `{ "reason": "…" }` (1–2000) | `PENDING` → `DECLINED` |
| `request-information` | `{ "question": "…" }` (1–2000) | `PENDING` \| `ACCEPTED` → `REQUESTED_INFORMATION` |
| `provide-information` | `{ "answer": "…" }` (1–4000) | `REQUESTED_INFORMATION` → `PENDING` |
| `complete` | none | `IN_PROGRESS` → `COMPLETED` |
| `cancel` | `{ "reason": "…" }` (optional, ≤ 2000) | `PENDING` \| `ACCEPTED` \| `REQUESTED_INFORMATION` → `CANCELLED` |

Each writes a timeline event, a notification to the counterparty and an audit row.

</details>

### Clinical (notes, vitals, observations)

Recording endpoints live under the patient (see [Patients](#patients)). The
observation endpoint takes a free-text finding rather than a measurement:

<details>
<summary><code>POST /api/patients/{id}/observations</code></summary>

**Body** — `observationSchema`: `category` (≤ 80), `content` (≤ 4000),
`severity` (`INFO` · `ATTENTION` · `CRITICAL`, optional).
A `CRITICAL` observation notifies the attending doctor immediately.

</details>

### Laboratory

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/labs/catalog` | `LAB_READ` | Orderable panels. |
| `GET` | `/api/labs/orders` | `LAB_READ` | Worklist. Visibility-filtered. |
| `POST` | `/api/labs/orders` | `LAB_ORDER` | Patient scope. Allocates `LAB-YYYY-NNNNN`. |
| `POST` | `/api/labs/orders/{id}/results` | `LAB_RESULT` | Pathology enters results. |

<details>
<summary><code>POST /api/labs/orders</code></summary>

**Body** — `createLabOrderSchema`: `patientId` (uuid), `panel` (≤ 160),
`clinicalInfo` (optional, ≤ 2000), `priority` (`ROUTINE` · `URGENT` · `STAT`),
`encounterId` (optional).

Ordering is what gives the pathology department access to that patient
(`DIAGNOSTIC_ORDER`) — narrowly, and only for as long as the order stands.

</details>

<details>
<summary><code>POST /api/labs/orders/{id}/results</code></summary>

**Body** — `labResultsSchema`: `results[]`, 1–60 entries of
`{ analyte, value, unit?, investigationCode?, comment? }`.

Each value is compared against its reference range and flagged `NORMAL`, `LOW`, `HIGH`,
`CRITICAL_LOW` or `CRITICAL_HIGH`. The order moves to `COMPLETED`, a timeline event is
written, and **any critical flag raises a `CRITICAL` notification to the ordering
clinician** rather than waiting to be noticed on a list.

</details>

<details>
<summary><code>GET /api/labs/orders</code></summary>

**Query** — `listQuerySchema`: `patientId` (uuid), `status` (comma-separated), `limit` (1–300).
Each row carries `resultCount` and `abnormalCount` so a worklist can be triaged without
opening every order.

</details>

### Radiology

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/radiology/studies` | `RADIOLOGY_READ` | Worklist. |
| `POST` | `/api/radiology/studies` | `RADIOLOGY_ORDER` | Patient scope. Allocates `RAD-YYYY-NNNNN`. |
| `PATCH` | `/api/radiology/studies/{id}` | `RADIOLOGY_REPORT` | Progress the study. |
| `POST` | `/api/radiology/studies/{id}/report` | `RADIOLOGY_REPORT` | File the report. |

<details>
<summary>Bodies</summary>

**`POST /api/radiology/studies`** — `createStudySchema`: `patientId`, `modality`
(`XRAY` · `CT` · `MRI` · `ULTRASOUND` · `OTHER`), `bodyPart` (≤ 120),
`description` (≤ 500), `clinicalInfo?` (≤ 2000), `contrastUsed?` (boolean),
`priority?`, `encounterId?`.

**`PATCH /api/radiology/studies/{id}`** — `studyStatusSchema`:
`status` ∈ `SCHEDULED` · `IN_PROGRESS` · `CANCELLED`.

**`POST /api/radiology/studies/{id}/report`** — `radiologyReportSchema`:
`findings` (≤ 12 000, required), `impression` (≤ 4000, required),
`recommendation?` (≤ 4000), `isCritical?` (boolean).

A report marked `isCritical` notifies the ordering clinician at `CRITICAL` severity and
appears on the timeline immediately — the imaging equivalent of a phoned-through result.

</details>

### Pharmacy

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/pharmacy/formulary` | `MEDICATION_READ` | Medicine catalogue. |
| `GET` | `/api/pharmacy/orders` | `MEDICATION_READ` | Prescriptions worklist. |
| `POST` | `/api/pharmacy/orders` | `MEDICATION_PRESCRIBE` | Patient scope. **Allergy interlock.** |
| `PATCH` | `/api/pharmacy/orders/{id}` | `MEDICATION_UPDATE` | Dispense, stop, complete. |
| `POST` | `/api/pharmacy/orders/{id}/administer` | `MEDICATION_ADMINISTER` | Nurse records a dose. |

<details>
<summary><code>POST /api/pharmacy/orders</code> — prescribing</summary>

**Body** — `prescribeSchema`

| Field | Type | Rules |
| --- | --- | --- |
| `patientId` | uuid | Required. |
| `medicineName` | string | Required, ≤ 200. |
| `medicationId` | uuid | Optional formulary link. |
| `dose` | string | Required, ≤ 80 (`"500 mg"`). |
| `frequency` | string | Required, ≤ 80 (`"TDS"`). |
| `route` | enum | `ORAL` · `IV` · `IM` · `SUBCUTANEOUS` · `TOPICAL` · `INHALATION` · `SUBLINGUAL` · `RECTAL` · `OTHER` |
| `instructions` | string | Optional, ≤ 1000. |
| `startDate` | date | Required. |
| `endDate` | date | Optional, on or after `startDate`. |

**409** `CONFLICT` when the medicine matches a recorded allergy. The response names the
conflict:

```json
{ "success": false, "error": {
  "code": "CONFLICT",
  "message": "Amoxicillin conflicts with a recorded allergy: Penicillin.",
  "details": { "conflicts": ["Penicillin"] } } }
```

This is a hard stop, not a warning banner. Overriding it is a deliberate, separate act:
the allergy must first be amended on the patient record, which is itself audited.

</details>

<details>
<summary><code>POST /api/pharmacy/orders/{id}/administer</code></summary>

**Body** — `administerSchema`: `doseGiven` (≤ 80, required), `wasWithheld?` (boolean),
`notes?` (≤ 1000).

A withheld dose is recorded as explicitly as a given one — the gap in a drug chart is
clinical information, so it is stored rather than left blank.

**`PATCH /api/pharmacy/orders/{id}`** — `medicationStatusUpdateSchema`:
`status` ∈ `PENDING` · `ACTIVE` · `STOPPED` · `COMPLETED` · `PENDING_DISPENSING` · `DISPENSED`,
plus `stopReason?` (≤ 1000).

</details>

### Admissions, wards & beds

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/admissions` | `ADMISSION_READ` | Visibility-filtered. |
| `POST` | `/api/admissions` | `ADMISSION_CREATE` | Allocates `ADM-YYYY-NNNNN`, occupies the bed. |
| `POST` | `/api/admissions/{id}/transfer` | `ADMISSION_TRANSFER` | Ward/bed move, audited. |
| `POST` | `/api/admissions/{id}/discharge` | `ADMISSION_DISCHARGE` | Requires a discharge summary. |
| `GET` | `/api/wards` | `WARD_READ` | With live occupancy. |
| `POST` | `/api/wards` | `WARD_MANAGE` | |
| `GET` | `/api/beds` | `WARD_READ` | |
| `POST` | `/api/beds` | `WARD_MANAGE` | |
| `PATCH` | `/api/beds/{id}` | `WARD_MANAGE` | `AVAILABLE` · `OCCUPIED` · `CLEANING` · `RESERVED` |

<details>
<summary>Bodies and invariants</summary>

**`POST /api/admissions`** — `createAdmissionSchema`: `patientId`, `departmentId`,
`attendingDoctorId`, `reason` (≤ 500), optional `wardId` and `bedId`.

Two invariants are enforced by partial unique indexes in the database, not only in
application code:

- `admissions_one_active_per_bed` — one active admission per bed.
- `admissions_one_open_per_patient` — one open admission per patient.

A race that slips past the service check still fails at the database with
`409 DUPLICATE_RESOURCE`. Requesting a bed that is not `AVAILABLE` returns
`409 BED_UNAVAILABLE`.

**`POST /api/admissions/{id}/transfer`** — `transferSchema`: `toWardId`,
optional `toBedId`, optional `reason` (≤ 500). Frees the old bed and occupies the new
one in one transaction.

**`POST /api/admissions/{id}/discharge`** — `dischargeSchema`: `summary`
(1–8000, required). The bed moves to `CLEANING` rather than straight to `AVAILABLE`.

</details>

### Notifications & realtime

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/notifications` | `NOTIFICATION_READ` | Cursor paginated. 600/min. |
| `PATCH` | `/api/notifications/{id}/read` | `NOTIFICATION_READ` | |
| `PATCH` | `/api/notifications/read-all` | `NOTIFICATION_READ` | |
| `GET` | `/api/realtime/stream` | authenticated | Server-Sent Events. |

<details>
<summary><code>GET /api/realtime/stream</code></summary>

**Query** — `patientId` (optional). With it, the stream also carries timeline events for
that patient, which is what makes an open chart update itself during a ward round.

**Response** — `text/event-stream`. The cursor lives in the database rather than in
process memory, so this behaves identically on one server and across many serverless
instances; an in-process event emitter would not.

```
event: connected
data: {"userId":"…","unreadCount":3,"at":"2026-09-06T09:12:44.118Z"}

event: notification
data: {"items":[{"id":"…","type":"REFERRAL_RESPONSE","title":"Cardiology has responded",
       "severity":"ATTENTION","link":"/referrals/…"}],"unreadCount":4}

event: patient-update
data: {"patientId":"…","items":[{"eventType":"VITALS_RECORDED","severity":"CRITICAL","…":"…"}]}

event: heartbeat
data: {"at":"2026-09-06T09:12:46.640Z"}

event: reconnect
data: {"reason":"stream-window-elapsed"}
```

Polled every 2.5 s; the stream closes itself at 50 s, just under the platform timeout,
and the browser's `EventSource` reconnects automatically. `src/hooks/use-realtime.ts`
turns each event into a React Query cache invalidation, so the UI re-fetches only what
changed.

**401** `UNAUTHENTICATED` (as JSON, not as a stream) when there is no valid session.

</details>

<details>
<summary><code>GET /api/notifications</code></summary>

**Query** — `notificationQuerySchema`: `unreadOnly` (`"true"` | `"false"`),
`limit` (1–100), `cursor` (opaque).
**200** — `data` is the notification array itself; `meta.unreadCount` carries the badge
count and `meta.nextCursor` is present when more remain. Cursor-paginated collections all
follow this shape: the rows in `data`, the pagination in `meta`.

</details>

### Messaging

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/messages` | `MESSAGE_READ` | Conversations with unread counts. |
| `POST` | `/api/messages` | `MESSAGE_SEND` | Start a conversation. |
| `GET` | `/api/messages/{id}` | `MESSAGE_READ` | Thread. Marks read for the caller. |
| `POST` | `/api/messages/{id}/messages` | `MESSAGE_SEND` | Reply. |

<details>
<summary>Bodies</summary>

**`POST /api/messages`** — `createConversationSchema`: `subject` (≤ 200),
`participantIds` (1–20 uuids), `patientId?`, `firstMessage?` (≤ 4000).
A conversation linked to a patient is only visible to participants who independently
pass the patient access check — attaching a patient does not widen access.

**`POST /api/messages/{id}/messages`** — `sendMessageSchema`: `body` (1–4000).
Non-participants get `403 FORBIDDEN`.

</details>

### Files

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/files` | `FILE_UPLOAD` | `multipart/form-data`. 60/min. |
| `GET` | `/api/files/{id}` | `FILE_READ` | Patient scope. Streams the bytes. |

<details>
<summary>Upload and download</summary>

**Form fields** — `file` (required), `category`
(`LAB_REPORT` · `RADIOLOGY_REPORT` · `MEDICAL_DOCUMENT` · `REFERRAL_ATTACHMENT` · `OTHER`,
defaults to `MEDICAL_DOCUMENT`), and optional `patientId`, `referralId`,
`referenceType`, `referenceId`.

```bash
curl -b jar.txt -X POST http://localhost:3000/api/files \
  -F 'file=@discharge-summary.pdf' \
  -F 'category=MEDICAL_DOCUMENT' \
  -F "patientId=$PATIENT_ID"
```

**201** — attachment metadata (`id`, `fileName`, `mimeType`, `sizeBytes`, `uploadedBy`,
`createdAt`). Bytes are stored in `file_blobs` inside the database, never in a public
bucket, so there is no URL that works without a session. Downloading re-runs the
patient access check on every request, and is served
`Content-Disposition: attachment` with `X-Content-Type-Options: nosniff`.

</details>

### AI (advisory only)

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/ai/patient-summary` | `AI_USE` | Patient scope. 30/min. |
| `GET` | `/api/ai/handover` | `AI_USE` | Shift handover across the caller's caseload. 30/min. |
| `POST` | `/api/ai/summaries/{id}/review` | `AI_USE` | Clinician marks a summary reviewed. |

<details>
<summary>Contract and constraints</summary>

**Body** — `aiSummarySchema`: `patientId` (uuid), `kind?` (`PATIENT_SUMMARY` ·
`TIMELINE_SUMMARY` · `LAB_SUMMARY` · `RADIOLOGY_SUMMARY` · `REFERRAL_BRIEF`),
`days?` (1–90).

```json
{ "success": true, "data": {
  "id": "…", "kind": "PATIENT_SUMMARY", "provider": "heuristic",
  "content": "54-year-old man, day 4 of admission under General Medicine…",
  "sourceFacts": ["4 vitals sets in 24 h", "2 abnormal laboratory results", "1 open referral"],
  "disclaimer": "Advisory only. Not a diagnosis. Verify against the source record.",
  "reviewedBy": null, "createdAt": "2026-09-06T…" } }
```

Three properties hold regardless of provider:

1. **Advisory only.** No endpoint writes a diagnosis, an order or a prescription from
   model output. A summary is a read-side convenience.
2. **Authorized input only.** The generator is fed the same filtered query results the
   caller could have read themselves. It cannot widen access.
3. **Attributable.** Every summary is stored with its provider, its source facts and a
   reviewer field, so a clinician can mark that they checked it.

With no API key configured the deterministic `HeuristicAiProvider` composes prose from
those structured facts — the feature works offline, and the demo does not depend on a
third-party key.

</details>

### Administration

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/admin/dashboard` | `ADMIN_DASHBOARD` | Hospital-wide KPIs. |
| `GET` | `/api/admin/staff` | `USER_READ` | Filterable. |
| `POST` | `/api/admin/staff` | `USER_CREATE` | Allocates a staff number. |
| `GET` | `/api/admin/staff/{id}` | `USER_READ` | |
| `PATCH` | `/api/admin/staff/{id}` | `USER_UPDATE` | |
| `POST` | `/api/admin/staff/{id}/role` | `USER_ROLE_CHANGE` | Audited. |
| `POST` | `/api/admin/staff/{id}/status` | `USER_UPDATE` | Deactivating revokes sessions. |
| `POST` | `/api/admin/staff/{id}/reset-password` | `USER_UPDATE` | 20/min. Revokes sessions. |
| `GET` | `/api/admin/departments` | `DEPARTMENT_MANAGE` | With staff counts. |
| `POST` | `/api/admin/departments` | `DEPARTMENT_MANAGE` | |
| `GET` | `/api/admin/roles` | `USER_READ` | Roles with their permission sets and user counts. |
| `GET` | `/api/admin/audit` | `AUDIT_READ` | The audit trail. |

<details>
<summary><code>POST /api/admin/staff</code></summary>

**Body** — `createStaffSchema`: `email`, `fullName` (≤ 160), `password` (≥ 10),
`role` (one of the nine), `designation` (≤ 120), optional `departmentId`,
`specialization`, `registrationNumber`, `phone`, `acceptsReferrals`.

**409** `DUPLICATE_RESOURCE` if the email is taken. Passwords are hashed with bcrypt at
cost 12 and never returned by any endpoint.

</details>

<details>
<summary><code>GET /api/admin/audit</code></summary>

**Query** — `auditQuerySchema`: `patientId?`, `userId?`, `action?` (≤ 80),
`entityType?` (≤ 80), `limit?` (1–200), `cursor?`.

```json
{ "success": true, "data": [{
  "id": "…", "action": "REFERRAL_RESPONDED", "outcome": "SUCCESS",
  "userId": "…", "userName": "Dr. Priya Mehta", "userRole": "SENIOR_DOCTOR",
  "patientId": "…", "entityType": "referral", "entityId": "…",
  "ipAddress": "10.0.0.9", "userAgent": "Mozilla/5.0 …",
  "createdAt": "2026-09-06T09:12:44.118Z" }],
  "meta": { "nextCursor": "…" } }
```

The table is **structurally append-only**: `caresync_audit_is_append_only()` raises on
`UPDATE` and `DELETE`, so an audit row cannot be rewritten even by a database
superuser session going around the API. There is deliberately no write endpoint —
entries are produced as a side effect of the actions they describe.

Denied access attempts appear here with `outcome: "DENIED"`, which is the point:
the interesting security events are the ones that failed.

</details>

### Reference & health

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/departments` | authenticated | For pickers. |
| `GET` | `/api/staff` | authenticated | Directory, no sensitive fields. |
| `GET` | `/api/health` | *public* | Liveness, database reachability and configuration validity. |

`GET /api/health` is the first thing to call when a deployment misbehaves.

```json
{ "success": true, "data": {
  "status": "ok", "database": "connected", "configuration": "ok",
  "time": "2026-09-06T18:11:52.659Z" } }
```

A `503` says which half is broken:

```json
{ "success": false, "error": {
  "code": "CONFIGURATION_ERROR",
  "message": "Missing or invalid environment variables: AUTH_SECRET. Set them and redeploy.",
  "details": { "database": "connected", "configuration": ["AUTH_SECRET"] } } }
```

**Names, never values.** The variable names are already public in `.env.example`, so
reporting them costs nothing and saves a great deal: a missing `AUTH_SECRET` otherwise
surfaces only as a generic `500` on sign-in, identical for every password anyone types,
with nothing anywhere to say why. Any endpoint that reaches the environment validator
returns the same `CONFIGURATION_ERROR` rather than an opaque `INTERNAL_ERROR`.

The endpoint reveals nothing further — no version, no host, no schema — because an
unauthenticated endpoint is not the place to describe the system.

---

## 7. The referral workflow, end to end

This is the acceptance criterion for the whole system, so here it is as a runnable
script. It is the same sequence `tests/integration/referral-workflow.test.ts` asserts
over twenty-five cases.

```bash
BASE=http://localhost:3000/api

# 1 ─ the referring doctor signs in
curl -s -c doctor.txt -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"doctor@caresync.demo","password":"CareSync#2026"}'

# 2 ─ find the patient and an available specialist
PATIENT=$(curl -s -b doctor.txt "$BASE/patients?q=PT-2026-00142" | jq -r '.data[0].id')
SPECIALIST=$(curl -s -b doctor.txt "$BASE/specialists" | jq -r '.data[0].id')

# 3 ─ raise the referral
REF=$(curl -s -b doctor.txt -X POST $BASE/referrals -H 'content-type: application/json' \
  -d "{\"patientId\":\"$PATIENT\",\"specialistDoctorId\":\"$SPECIALIST\",
       \"reason\":\"Chest pain with ECG changes\",
       \"clinicalSummary\":\"54-year-old man, day 4 of admission…\",
       \"priority\":\"URGENT\"}" | jq -r '.data.id')

# 4 ─ the specialist signs in and sees it in their inbox
curl -s -c spec.txt -X POST $BASE/auth/login -H 'content-type: application/json' \
  -d '{"email":"specialist@caresync.demo","password":"CareSync#2026"}'
curl -s -b spec.txt "$BASE/referrals?box=incoming" | jq '.data[0].referralNumber'

# 5 ─ accept (this grants access to the patient and joins the care team)
curl -s -b spec.txt -X POST $BASE/referrals/$REF/accept

# 6 ─ respond with the clinical opinion
curl -s -b spec.txt -X POST $BASE/referrals/$REF/respond -H 'content-type: application/json' \
  -d '{"assessment":"Likely NSTEMI.","findings":"Troponin rising; lateral ST depression.",
       "recommendations":"Dual antiplatelet therapy; inpatient angiography.",
       "treatmentPlan":"Aspirin 300 mg stat, then 75 mg daily…",
       "followUp":"Cardiology review in 48 hours."}'

# 7 ─ close the loop
curl -s -b spec.txt -X POST $BASE/referrals/$REF/complete

# 8 ─ the referring doctor is notified, and the opinion is on the chart
curl -s -b doctor.txt "$BASE/notifications?unreadOnly=true" | jq '.data[].title'
curl -s -b doctor.txt "$BASE/patients/$PATIENT/timeline" | jq '.data[].eventType'
curl -s -b doctor.txt "$BASE/patients/$PATIENT/notes" | jq '.data[] | select(.noteType=="SPECIALIST")'
```

Step 8 is the part that matters. The specialist's opinion is not trapped inside the
referral: it is a `SPECIALIST` note on the patient's chart, four events on the timeline
(`REFERRAL_CREATED`, `REFERRAL_ACCEPTED`, `REFERRAL_RESPONSE`, `REFERRAL_COMPLETED`),
three notifications to the referrer, and a matching row in the audit trail for every one
of them. That is what "one connected view of the patient" has to mean to be worth saying.

---

## 8. Enumerations

| Enum | Values |
| --- | --- |
| `Role` | `SUPER_ADMIN` · `HOSPITAL_ADMIN` · `SENIOR_DOCTOR` · `JUNIOR_DOCTOR` · `NURSE` · `RADIOLOGY` · `PATHOLOGY` · `PHARMACY` · `HR_ADMIN` |
| `PatientStatus` | `STABLE` · `NEEDS_ATTENTION` · `CRITICAL` |
| `Gender` | `MALE` · `FEMALE` · `OTHER` · `UNKNOWN` |
| `BloodGroup` | `A_POSITIVE` · `A_NEGATIVE` · `B_POSITIVE` · `B_NEGATIVE` · `AB_POSITIVE` · `AB_NEGATIVE` · `O_POSITIVE` · `O_NEGATIVE` · `UNKNOWN` |
| `ReferralStatus` | `PENDING` · `ACCEPTED` · `IN_PROGRESS` · `REQUESTED_INFORMATION` · `COMPLETED` · `DECLINED` · `CANCELLED` |
| `ReferralPriority` | `ROUTINE` · `URGENT` · `EMERGENCY` |
| `OrderPriority` | `ROUTINE` · `URGENT` · `STAT` |
| `NoteType` | `ADMISSION` · `PROGRESS` · `CONSULTATION` · `NURSING` · `SPECIALIST` · `DISCHARGE` |
| `ResultFlag` | `NORMAL` · `LOW` · `HIGH` · `CRITICAL_LOW` · `CRITICAL_HIGH` |
| `Modality` | `XRAY` · `CT` · `MRI` · `ULTRASOUND` · `OTHER` |
| `MedicationRoute` | `ORAL` · `IV` · `IM` · `SUBCUTANEOUS` · `TOPICAL` · `INHALATION` · `SUBLINGUAL` · `RECTAL` · `OTHER` |
| `MedicationStatus` | `PENDING` · `ACTIVE` · `STOPPED` · `COMPLETED` · `PENDING_DISPENSING` · `DISPENSED` |
| `BedStatus` | `AVAILABLE` · `OCCUPIED` · `CLEANING` · `RESERVED` |
| `AdmissionStatus` | `ADMITTED` · `TRANSFERRED` · `DISCHARGED` |
| `CareTeamRole` | `ATTENDING` · `CONSULTING` · `SPECIALIST` · `RESIDENT` · `PRIMARY_NURSE` · `NURSE` |
| `Severity` | `INFO` · `ATTENTION` · `CRITICAL` |
| `FileCategory` | `LAB_REPORT` · `RADIOLOGY_REPORT` · `MEDICAL_DOCUMENT` · `REFERRAL_ATTACHMENT` · `OTHER` |
| `AiSummaryKind` | `PATIENT_SUMMARY` · `TIMELINE_SUMMARY` · `LAB_SUMMARY` · `RADIOLOGY_SUMMARY` · `REFERRAL_BRIEF` |
| `AccessReason` | `OVERSIGHT_ROLE` · `ATTENDING_DOCTOR` · `CARE_TEAM` · `ENCOUNTER_PROVIDER` · `REFERRAL_PARTY` · `EXPLICIT_GRANT` · `DIAGNOSTIC_ORDER` · `WARD_NURSE` · `DENIED` |

The full permission list (48 permissions across the nine roles) is
`ROLE_PERMISSIONS` in [`src/types/rbac.ts`](../src/types/rbac.ts), and
`GET /api/admin/roles` returns it at runtime.

---

*Demo data only. Every patient, clinician and result in this system is fabricated.*
