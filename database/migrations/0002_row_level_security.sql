-- ============================================================================
-- CareSync Hospital — migration 0002: Row Level Security
--
-- These policies mirror `src/server/services/patient-access.service.ts`
-- one-for-one, so authorization is enforced in the database as well as in the
-- service layer (defense in depth, not a substitute for it).
--
-- HOW IT APPLIES
--   * The application's own connection is the table owner. Postgres exempts
--     table owners from RLS unless FORCE ROW LEVEL SECURITY is set, so by
--     default these policies govern *every other* role: a Supabase
--     `anon`/`authenticated` client, a BI tool, an analytics read-replica user
--     or a leaked read-only credential. That is exactly where they matter.
--   * To additionally force them on the app's own role (recommended once you
--     run the app under a dedicated non-owner role), run:
--         SELECT caresync_force_rls();
--     and make every query go through `withPatientRlsContext()` from
--     `src/server/db/rls.ts`, which sets the request GUCs inside a transaction.
-- ============================================================================

CREATE OR REPLACE FUNCTION caresync_current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('caresync.user_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION caresync_current_role() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('caresync.role', true), ''), 'ANONYMOUS');
$$ LANGUAGE sql STABLE;
--> statement-breakpoint

-- Mirrors PatientAccessService.canAccess()
CREATE OR REPLACE FUNCTION caresync_can_access_patient(p_patient_id uuid) RETURNS boolean AS $$
DECLARE
  uid  uuid := caresync_current_user_id();
  urole text := caresync_current_role();
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;

  -- Hospital-wide oversight roles
  IF urole IN ('SUPER_ADMIN', 'HOSPITAL_ADMIN') THEN RETURN true; END IF;

  -- Attending doctor on any admission for this patient
  IF EXISTS (SELECT 1 FROM admissions a
             WHERE a.patient_id = p_patient_id AND a.attending_doctor_id = uid) THEN
    RETURN true;
  END IF;

  -- Named member of the care team
  IF EXISTS (SELECT 1 FROM care_team_members c
             WHERE c.patient_id = p_patient_id AND c.user_id = uid AND c.removed_at IS NULL) THEN
    RETURN true;
  END IF;

  -- Provider on an encounter
  IF EXISTS (SELECT 1 FROM encounters e
             WHERE e.patient_id = p_patient_id AND e.provider_id = uid) THEN
    RETURN true;
  END IF;

  -- Party to a referral (referring doctor keeps access; specialist gains it)
  IF EXISTS (SELECT 1 FROM referrals r
             WHERE r.patient_id = p_patient_id
               AND (r.referring_doctor_id = uid OR r.specialist_doctor_id = uid)) THEN
    RETURN true;
  END IF;

  -- Explicit, time-boxed grant (referral acceptance, emergency access, admin)
  IF EXISTS (SELECT 1 FROM patient_access_grants g
             WHERE g.patient_id = p_patient_id AND g.user_id = uid
               AND g.revoked_at IS NULL
               AND (g.expires_at IS NULL OR g.expires_at > now())) THEN
    RETURN true;
  END IF;

  -- Diagnostic departments: access follows an order that reached them
  IF urole = 'PATHOLOGY' AND EXISTS (
      SELECT 1 FROM investigation_orders o
      WHERE o.patient_id = p_patient_id AND o.category = 'LAB') THEN
    RETURN true;
  END IF;

  IF urole = 'RADIOLOGY' AND EXISTS (
      SELECT 1 FROM radiology_studies s WHERE s.patient_id = p_patient_id) THEN
    RETURN true;
  END IF;

  IF urole = 'PHARMACY' AND EXISTS (
      SELECT 1 FROM medication_orders m WHERE m.patient_id = p_patient_id) THEN
    RETURN true;
  END IF;

  -- Nurses: patients admitted to a ward in their department
  IF urole = 'NURSE' AND EXISTS (
      SELECT 1 FROM admissions a
      JOIN staff_profiles sp ON sp.user_id = uid
      WHERE a.patient_id = p_patient_id
        AND a.status = 'ADMITTED'
        AND a.department_id = sp.department_id) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
--> statement-breakpoint

-- Patient-scoped tables get a policy keyed on patient_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','patient_contacts','admissions','encounters','care_team_members',
    'clinical_notes','vital_signs','observations','investigation_orders',
    'investigation_results','radiology_studies','medication_orders','referrals',
    'timeline_events','ai_summaries','attachments','patient_access_grants'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_patient_access', t);
    IF t = 'patients' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (caresync_can_access_patient(id))
         WITH CHECK (caresync_can_access_patient(id))', t || '_patient_access', t);
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (caresync_can_access_patient(patient_id))
         WITH CHECK (caresync_can_access_patient(patient_id))', t || '_patient_access', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- Notifications and messages are private to their recipient / participants.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS notifications_own ON notifications;
--> statement-breakpoint
CREATE POLICY notifications_own ON notifications FOR ALL
  USING (recipient_id = caresync_current_user_id())
  WITH CHECK (recipient_id = caresync_current_user_id());
--> statement-breakpoint

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS messages_participant ON messages;
--> statement-breakpoint
CREATE POLICY messages_participant ON messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversation_participants cp
                 WHERE cp.conversation_id = messages.conversation_id
                   AND cp.user_id = caresync_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM conversation_participants cp
                      WHERE cp.conversation_id = messages.conversation_id
                        AND cp.user_id = caresync_current_user_id()));
--> statement-breakpoint

-- Audit log is readable only by oversight roles; never writable via RLS paths.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS audit_logs_admin_read ON audit_logs;
--> statement-breakpoint
CREATE POLICY audit_logs_admin_read ON audit_logs FOR SELECT
  USING (caresync_current_role() IN ('SUPER_ADMIN','HOSPITAL_ADMIN'));
--> statement-breakpoint

-- Opt-in switch: also enforce the policies against the owning role.
CREATE OR REPLACE FUNCTION caresync_force_rls() RETURNS void AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','patient_contacts','admissions','encounters','care_team_members',
    'clinical_notes','vital_signs','observations','investigation_orders',
    'investigation_results','radiology_studies','medication_orders','referrals',
    'timeline_events','ai_summaries','attachments','patient_access_grants',
    'notifications','messages','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION caresync_unforce_rls() RETURNS void AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patients','patient_contacts','admissions','encounters','care_team_members',
    'clinical_notes','vital_signs','observations','investigation_orders',
    'investigation_results','radiology_studies','medication_orders','referrals',
    'timeline_events','ai_summaries','attachments','patient_access_grants',
    'notifications','messages','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$ LANGUAGE plpgsql;
