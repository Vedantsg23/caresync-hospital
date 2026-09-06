-- ============================================================================
-- CareSync Hospital — migration 0001: integrity, auditability, search
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. updated_at is maintained by the database, not only by application code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION caresync_set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','departments','staff_profiles','patients','wards','beds','admissions',
    'encounters','clinical_notes','investigation_orders','radiology_studies',
    'medication_orders','referrals','referral_responses'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I; CREATE TRIGGER %I BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION caresync_set_updated_at();',
      'set_updated_at_' || t, t, 'set_updated_at_' || t, t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. audit_logs is append-only at the database level.
--    Application code has no UPDATE/DELETE path; this makes that structural.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION caresync_audit_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION caresync_audit_is_append_only();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A bed can hold at most one active admission.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS admissions_one_active_per_bed
  ON admissions (bed_id) WHERE status = 'ADMITTED' AND bed_id IS NOT NULL;
--> statement-breakpoint

-- A patient can have at most one open admission.
CREATE UNIQUE INDEX IF NOT EXISTS admissions_one_open_per_patient
  ON admissions (patient_id) WHERE status = 'ADMITTED';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Patient search — trigram index when the extension is available,
--    otherwise a lower() b-tree fallback. Never fails the migration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXECUTE 'CREATE INDEX IF NOT EXISTS patients_search_trgm
             ON patients USING gin ((lower(first_name || '' '' || last_name || '' '' || patient_number)) gin_trgm_ops)';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS patients_search_lower
             ON patients ((lower(first_name || '' '' || last_name)))';
  END;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS patients_number_lower_idx ON patients (lower(patient_number));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS admissions_number_lower_idx ON admissions (lower(admission_number));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Pathology-facing views.
--    `investigation_orders` / `investigation_results` are the single source of
--    truth for both lab and imaging orders. These views expose the pathology
--    slice under the conventional names with zero risk of data drift.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW lab_orders AS
  SELECT id, order_number, patient_id, admission_id, encounter_id, panel,
         clinical_info, priority, status, department_id, ordered_by_id,
         ordered_at, collected_at, completed_at, created_at, updated_at
  FROM investigation_orders
  WHERE category = 'LAB';
--> statement-breakpoint

CREATE OR REPLACE VIEW lab_results AS
  SELECT r.id, r.order_id, r.patient_id, r.investigation_id, r.analyte, r.value,
         r.numeric_value, r.unit, r.reference_range, r.flag, r.comment,
         r.resulted_by_id, r.resulted_at, r.created_at
  FROM investigation_results r
  JOIN investigation_orders o ON o.id = r.order_id
  WHERE o.category = 'LAB';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Referral state machine guard — invalid transitions are rejected by the
--    database even if a future caller bypasses the service layer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION caresync_referral_transition() RETURNS trigger AS $$
DECLARE
  allowed text[];
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  allowed := CASE OLD.status
    WHEN 'PENDING'               THEN ARRAY['ACCEPTED','DECLINED','CANCELLED','REQUESTED_INFORMATION']
    WHEN 'REQUESTED_INFORMATION' THEN ARRAY['PENDING','ACCEPTED','DECLINED','CANCELLED']
    WHEN 'ACCEPTED'              THEN ARRAY['IN_PROGRESS','REQUESTED_INFORMATION','COMPLETED','CANCELLED']
    WHEN 'IN_PROGRESS'           THEN ARRAY['COMPLETED','REQUESTED_INFORMATION','CANCELLED']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status::text = ANY(allowed)) THEN
    RAISE EXCEPTION 'Invalid referral transition % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS referrals_transition_guard ON referrals;
--> statement-breakpoint
CREATE TRIGGER referrals_transition_guard BEFORE UPDATE OF status ON referrals
  FOR EACH ROW EXECUTE FUNCTION caresync_referral_transition();
