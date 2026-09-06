-- ============================================================================
-- CareSync Hospital — migration 0003: one active care-team row per person
-- ============================================================================
--
-- A clinician is either on a patient's care team or they is not. There is no
-- meaning to being on it twice, and a duplicated name reads as a broken system
-- on the one screen where a clinician most needs to trust what they see.
--
-- Three code paths add care-team rows: registering a patient, admitting one,
-- and a specialist accepting a referral. Only the explicit "add to care team"
-- endpoint checked for an existing row first, so a specialist who accepted two
-- referrals for the same patient appeared twice on the chart.
--
-- Guarding each call site would leave the invariant one new call site away from
-- breaking again, so it is enforced here instead. The services still avoid the
-- conflict; this makes it impossible rather than merely unlikely.
-- ---------------------------------------------------------------------------

-- 1. Retire the duplicates that already exist, keeping the earliest active row
--    for each (patient, clinician) pair. Soft removal, so history survives.
UPDATE care_team_members c
SET removed_at = now()
WHERE c.removed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM care_team_members keep
    WHERE keep.patient_id = c.patient_id
      AND keep.user_id    = c.user_id
      AND keep.removed_at IS NULL
      AND (keep.assigned_at, keep.id) < (c.assigned_at, c.id)
  );
--> statement-breakpoint

-- 2. A partial unique index: at most one *active* membership per pair, while
--    any number of historical (removed) rows may remain for the audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS care_team_one_active_per_patient_user
  ON care_team_members (patient_id, user_id)
  WHERE removed_at IS NULL;
