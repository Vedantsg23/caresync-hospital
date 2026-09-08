# Authentication and account lifecycle

There are no predefined accounts in a deployment. There is no shared password.
An account exists because a person asked for one and an administrator granted
it, or because an administrator invited them.

The governing rule, which every part of this file is a consequence of:

> **Registration is self-service. Privilege is not.**

Anyone can ask for an account. Nobody can give themselves a role.

## How the rule is enforced

A registration writes `requested_role`. It never writes `primary_role`.

`primary_role` defaults to `NURSE` with `is_active = false`, which is the
lowest-privilege role in the system and inert while the account is inactive. The
only two code paths that ever write `primary_role` are `approveAccount`, which
requires the `user:approve` permission, and `acceptInvitation`, which requires
a signed invitation token issued by someone who holds `user:invite`.

So an attacker who posts `{"primaryRole": "HOSPITAL_ADMIN"}` to the registration
endpoint gets an inactive nurse account awaiting approval, exactly like everyone
else. There is no field to send, no parameter to tamper with, and no ordering of
requests that produces a privileged account. The registration form's role list
is a convenience for the person filling it in; the server would refuse an
administrator role regardless of what the form offers.

`tests/integration/security.test.ts` asserts this from the attacker's side,
including that a hospital administrator cannot approve somebody into an
administrator role.

## Account states

`account_status` is an enum, and login consults it **after** verifying the
password, never before — otherwise the endpoint becomes an oracle telling an
attacker which addresses are registered and what state they are in.

| State | Meaning | What sign-in says |
|---|---|---|
| `PENDING_VERIFICATION` | Registered, email not confirmed | "Confirm your email address…" (403) |
| `PENDING_APPROVAL` | Email confirmed, waiting on an administrator | "awaiting administrator approval" (403) |
| `ACTIVE` | Approved and usable | signs in |
| `REJECTED` | An administrator refused it | generic `INVALID_CREDENTIALS` |
| `SUSPENDED` | Temporarily disabled | generic `INVALID_CREDENTIALS` |
| `DEACTIVATED` | A leaver | generic `INVALID_CREDENTIALS` |

The last three are deliberately indistinguishable from a wrong password. Someone
whose access was removed does not get to learn that the account still exists,
and someone probing does not get to enumerate former staff.

## The flows

### Registration

1. `POST /api/auth/register` — name, work email, password, requested role,
   optional department and a free-text note for the approver (registration
   number, specialty, who can vouch for them).
2. A verification email is sent. The token is random, SHA-256 hashed at rest,
   single-use, and expires in 24 hours.
3. `POST /api/auth/verify-email` consumes it and moves the account to
   `PENDING_APPROVAL`.
4. An administrator sees it at `/admin/registrations` and approves or rejects.
   Approval is where the role and department are actually assigned — the
   approver chooses them, and may choose something other than what was asked
   for.
5. Only then can the person sign in.

Registering an address that already exists returns **the same response** as a
new registration, and sends mail to the real owner telling them someone tried.
The endpoint reveals nothing either way. Rate limited to
`RATE_LIMIT_REGISTER_PER_HOUR` (default 5) per IP.

### Invitation

An administrator with `user:invite` can skip the queue:
`POST /api/admin/invitations` with an email, role and department. The invitee
gets a link, sets their own password at `/accept-invitation`, and the account is
`ACTIVE` immediately — the administrator has already vouched by choosing the
role. Invitation tokens last 7 days.

### Password reset

`POST /api/auth/forgot-password` returns the same response whether or not the
address exists. If it does, and the account is in a state that can sign in, a
reset link is sent — hashed, single-use, 30 minutes.

`POST /api/auth/reset-password` refuses to set the password to the current one,
clears any lockout, and **revokes every session** for that user. Somebody who
resets a password because they think it was compromised should not have to
wonder whether the attacker is still signed in somewhere.

A partial unique index guarantees at most one live token per (email, purpose),
so requesting five resets does not leave five valid links in five inboxes.

### The first administrator

A production database starts empty, so there is nobody to sign in as and nobody
to approve the first registration. `POST /api/auth/bootstrap` solves that
exactly once:

- It requires `BOOTSTRAP_TOKEN`, compared in constant time.
- It **refuses to run if any active administrator already exists**, so it cannot
  be used to add a second back door later.
- The token should be removed from the environment afterwards. Leaving it set is
  harmless while an administrator exists, but there is no reason to.

See `docs/DEPLOYMENT.md` for the exact call.

## Sessions

A session is a signed JWT (`jose`, HS256) **and** a row in `sessions`. Both are
required. The JWT makes the common case cheap — the edge middleware verifies a
signature without touching the database — and the row makes revocation
immediate, because deleting it invalidates the token everywhere at once. A
signature alone cannot be taken back before it expires; that is the whole reason
the row exists.

- `SESSION_MAX_AGE` (default 8 hours, one hospital shift) is the idle lifetime.
- `SESSION_ABSOLUTE_MAX_AGE` (default 7 days) is a ceiling that activity cannot
  extend. `rotateSession` issues a new session and revokes the old one, and
  refuses once the absolute expiry has passed.
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

The middleware is a fast first gate, not the security boundary. Every API route
independently re-verifies the session against the database and checks the
caller's permission, and PostgreSQL row-level security sits underneath both.

## Passwords

- bcrypt, cost 12. Roughly a quarter-second per hash, which is the point: it
  costs an attacker the same, multiplied by their dictionary. It is also the
  single most expensive thing this application does per sign-in — see
  `docs/LOAD_TESTING.md`.
- Minimum 10 characters, with lower case, upper case and a digit. Checked on the
  server; the client shows the same rules live so nobody discovers them by
  being rejected.
- Never logged, never returned, never compared outside `bcrypt.compare`.
- Repeated failures lock the account temporarily, and sign-in is rate limited
  per IP as well (`RATE_LIMIT_LOGIN_PER_MIN`, default 10) — verified as 10
  through then `429` in `docs/LOAD_TESTING.md`.

## Tokens

Every verification, reset and invitation token follows the same shape:

- 32 random bytes, base64url.
- Stored as SHA-256, so the table is useless to somebody who reads it.
- Single-use, claimed and validated in **one** UPDATE, so two simultaneous
  requests cannot both succeed:

  ```sql
  UPDATE verification_tokens SET consumed_at = now()
   WHERE token_hash = $1 AND purpose = $2
     AND consumed_at IS NULL AND expires_at > now()
  RETURNING …
  ```

- Never written to a log. In development the console mail driver prints the
  message body so the flows can be exercised without a provider; in production
  it does not, because a token in a log file is a token an attacker can use.

## Email

`MAIL_DRIVER` selects the implementation behind one interface:

- `console` (default) records messages in memory and prints them outside
  production. Every flow above works with no provider configured.
- `resend` posts to the Resend API.
- `smtp` uses `nodemailer` if it is installed.

Mail is sent through `sendQuietly`, which never lets a delivery failure break
the operation that triggered it. An approval that succeeded must not be reported
as failed because a mail server was slow.
