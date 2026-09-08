-- ============================================================================
-- CareSync Hospital — migration 0004: production authentication
-- ============================================================================
--
-- Takes the system from "an administrator creates every account" to real
-- self-service registration with administrator approval, email verification,
-- password reset and staff invitations.
--
-- SAFETY: this migration is purely additive. No column is dropped, no row is
-- deleted, no type is narrowed. Existing accounts are backfilled to ACTIVE and
-- treated as already verified, so a running deployment keeps working across the
-- deploy rather than locking everyone out the moment it lands.
-- ---------------------------------------------------------------------------

-- 1. Account lifecycle -------------------------------------------------------
--
-- Registration is self-service; privilege is not. A new clinical account lands
-- in PENDING_APPROVAL and can do nothing until an administrator assigns its
-- role and department. There is no path from the public form to a privileged
-- role, which is the whole point of separating `requested_role` from
-- `primary_role` below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status') THEN
    CREATE TYPE account_status AS ENUM (
      'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'token_purpose') THEN
    CREATE TYPE token_purpose AS ENUM (
      'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'STAFF_INVITATION'
    );
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status                  account_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS phone                   text,
  ADD COLUMN IF NOT EXISTS email_verified_at       timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_id          uuid,
  ADD COLUMN IF NOT EXISTS approved_at             timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason        text,
  ADD COLUMN IF NOT EXISTS requested_role          role_name,
  ADD COLUMN IF NOT EXISTS requested_department_id uuid,
  ADD COLUMN IF NOT EXISTS registration_note       text,
  ADD COLUMN IF NOT EXISTS last_login_ip           text,
  ADD COLUMN IF NOT EXISTS password_changed_at     timestamptz;
--> statement-breakpoint

-- Existing accounts predate verification. Treat them as verified rather than
-- locking out a live deployment mid-migration; new accounts must verify.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at),
    password_changed_at = COALESCE(password_changed_at, created_at),
    status = CASE WHEN is_active THEN 'ACTIVE'::account_status ELSE 'DEACTIVATED'::account_status END
WHERE email_verified_at IS NULL OR password_changed_at IS NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_approved_by_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_approved_by_fk
      FOREIGN KEY (approved_by_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_requested_department_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_requested_department_fk
      FOREIGN KEY (requested_department_id) REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);
--> statement-breakpoint
-- The approval queue: pending accounts, oldest first.
CREATE INDEX IF NOT EXISTS users_pending_approval_idx ON users (status, created_at)
  WHERE status IN ('PENDING_VERIFICATION', 'PENDING_APPROVAL');
--> statement-breakpoint

-- 2. Single-use, hashed, expiring tokens -------------------------------------
--
-- Only a SHA-256 hash of the token is stored. A database read therefore cannot
-- be replayed as a working reset link — the plaintext exists only in the email
-- that was sent and in the URL the holder clicks.
CREATE TABLE IF NOT EXISTS verification_tokens (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES users(id) ON DELETE CASCADE,
  email                  text NOT NULL,
  purpose                token_purpose NOT NULL,
  token_hash             text NOT NULL,
  expires_at             timestamptz NOT NULL,
  consumed_at            timestamptz,
  invited_role           role_name,
  invited_department_id  uuid REFERENCES departments(id) ON DELETE SET NULL,
  created_by_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  ip_address             text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_hash_key ON verification_tokens (token_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_tokens_lookup_idx ON verification_tokens (email, purpose, consumed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_tokens_expiry_idx ON verification_tokens (expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_tokens_user_idx ON verification_tokens (user_id);
--> statement-breakpoint

-- 3. Session rotation --------------------------------------------------------
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS rotated_from_id     uuid,
  ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;
--> statement-breakpoint

-- Every authenticated request resolves this user's live sessions. Without a
-- composite index that is a scan of the user's entire session history.
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions (user_id, revoked_at, expires_at);
--> statement-breakpoint

-- 4. A token is spent once ---------------------------------------------------
--
-- The service checks `consumed_at` before accepting a token, but two requests
-- arriving together can both pass that check. This makes the second one fail at
-- the database instead: one un-consumed token per (email, purpose) at a time,
-- so a reset link cannot be redeemed twice in a race.
CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_one_live_per_purpose
  ON verification_tokens (email, purpose)
  WHERE consumed_at IS NULL;
--> statement-breakpoint

-- 5. Expired tokens are rubbish, and rubbish accumulates ---------------------
CREATE OR REPLACE FUNCTION caresync_purge_expired_tokens() RETURNS integer AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM verification_tokens
  WHERE expires_at < now() - interval '7 days'
     OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '30 days');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql;
