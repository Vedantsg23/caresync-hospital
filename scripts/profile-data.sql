-- Synthetic volume for query profiling and load testing.
--
-- Nothing here is realistic clinical data and none of it is ever loaded into a
-- deployment: it exists so that EXPLAIN ANALYZE and k6 measure something other
-- than a sequential scan over thirty rows. The shape matters more than the
-- content — the distribution of patients per consultant, notes per admission
-- and events per patient is what decides which index the planner picks.

\set ON_ERROR_STOP on
\timing on

SET synchronous_commit = off;

-- Every lateral pick below hashes the OUTER row id together with the CANDIDATE
-- row id. Hashing only the outer id gives every candidate the same sort key, so
-- Postgres returns one arbitrary winner for all of them — which is how a first
-- attempt at this file handed a single consultant 30,024 of 30,027 admissions
-- and made the visibility filter look far more expensive than it is.

-- ---------------------------------------------------------------- patients --
INSERT INTO patients (patient_number, first_name, last_name, date_of_birth, gender, blood_group, phone, city, status, created_at)
SELECT
  'PS-' || lpad(g::text, 8, '0'),
  (ARRAY['Aarav','Priya','Rohan','Meera','Kabir','Anaya','Vikram','Sana','Arjun','Leena'])[1 + (g % 10)],
  (ARRAY['Sharma','Nair','Iyer','Kapoor','Reddy','Bose','Gupta','Menon','Patel','Rao'])[1 + ((g / 7) % 10)],
  (DATE '1935-01-01' + ((g * 13) % 30000)),
  (ARRAY['MALE','FEMALE','OTHER'])[1 + (g % 3)]::gender,
  (ARRAY['A_POSITIVE','O_POSITIVE','B_POSITIVE','AB_POSITIVE','O_NEGATIVE'])[1 + (g % 5)]::blood_group,
  '+9198' || lpad((g % 100000000)::text, 8, '0'),
  (ARRAY['Pune','Mumbai','Nashik','Nagpur','Thane'])[1 + (g % 5)],
  (ARRAY['STABLE','STABLE','STABLE','STABLE','NEEDS_ATTENTION','CRITICAL'])[1 + (g % 6)]::patient_status,
  now() - ((g % 900) || ' days')::interval
FROM generate_series(1, 50000) g;

-- -------------------------------------------------------------- admissions --
-- 60% of patients have an admission; a fifth of those are still open.
INSERT INTO admissions (patient_id, admission_number, admission_date, discharge_date, department_id, attending_doctor_id, reason, status, created_at)
SELECT
  p.id,
  'ADM-' || lpad(p.h::text, 9, '0'),
  now() - ((p.h % 700) || ' days')::interval,
  CASE WHEN p.h % 5 = 0 THEN NULL ELSE now() - ((p.h % 700) || ' days')::interval + '4 days'::interval END,
  d.id,
  doc.id,
  (ARRAY['Chest pain','Breathlessness','Fever under investigation','Post-operative care','Trauma'])[1 + (p.h % 5)],
  (CASE WHEN p.h % 5 = 0 THEN 'ADMITTED' ELSE 'DISCHARGED' END)::admission_status,
  now() - ((p.h % 700) || ' days')::interval
FROM (
  SELECT id, row_number() OVER (ORDER BY patient_number) AS h FROM patients WHERE patient_number LIKE 'PS-%'
) p
CROSS JOIN LATERAL (SELECT id FROM departments ORDER BY md5(p.id::text || id::text) LIMIT 1) d
CROSS JOIN LATERAL (SELECT id FROM users WHERE primary_role IN ('SENIOR_DOCTOR','JUNIOR_DOCTOR') ORDER BY md5(p.id::text || id::text) LIMIT 1) doc
WHERE p.h % 10 < 6;

-- ---------------------------------------------------------- care team rows --
INSERT INTO care_team_members (patient_id, admission_id, user_id, role, assigned_at)
SELECT a.patient_id, a.id, u.id, 'PRIMARY_NURSE'::care_team_role, a.admission_date
FROM admissions a
CROSS JOIN LATERAL (SELECT id FROM users WHERE primary_role = 'NURSE' ORDER BY md5(a.id::text || id::text) LIMIT 1) u
WHERE a.admission_number LIKE 'ADM-%'
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------- timeline events --
-- ~1.2m rows: 40 per admission, which is a fortnight of an active chart.
INSERT INTO timeline_events (patient_id, admission_id, event_type, title, description, actor_id, department_id, severity, occurred_at, created_at)
SELECT
  a.patient_id, a.id,
  (ARRAY['ADMISSION_CREATED','VITALS_RECORDED','CLINICAL_NOTE','INVESTIGATION_ORDERED','LAB_RESULT','MEDICATION_ORDERED'])[1 + (s % 6)]::timeline_event_type,
  'Event ' || s,
  'Synthetic profiling row.',
  a.attending_doctor_id, a.department_id,
  (ARRAY['INFO','INFO','INFO','ATTENTION','CRITICAL'])[1 + (s % 5)]::event_severity,
  a.admission_date + ((s * 37) || ' minutes')::interval,
  a.admission_date + ((s * 37) || ' minutes')::interval
FROM admissions a, generate_series(1, 40) s
WHERE a.admission_number LIKE 'ADM-%';

-- ------------------------------------------------------------- vital signs --
INSERT INTO vital_signs (patient_id, admission_id, temperature_c, heart_rate, blood_pressure_systolic, blood_pressure_diastolic, spo2, respiratory_rate, news_score, is_abnormal, recorded_by_id, recorded_at, created_at)
SELECT
  a.patient_id, a.id,
  36.2 + ((s % 25) * 0.1), 60 + (s % 60), 100 + (s % 60), 60 + (s % 30),
  92 + (s % 8), 12 + (s % 12), (s % 12), (s % 12) >= 5,
  a.attending_doctor_id,
  a.admission_date + ((s * 4) || ' hours')::interval,
  a.admission_date + ((s * 4) || ' hours')::interval
FROM admissions a, generate_series(1, 20) s
WHERE a.admission_number LIKE 'ADM-%';

-- ---------------------------------------------------------- clinical notes --
INSERT INTO clinical_notes (patient_id, admission_id, note_type, title, content, author_id, author_role, department_id, version, is_retired, created_at, updated_at)
SELECT
  a.patient_id, a.id,
  (ARRAY['PROGRESS','ADMISSION','CONSULTATION','NURSING'])[1 + (s % 4)]::note_type,
  'Progress note ' || s,
  repeat('Synthetic clinical narrative. ', 12),
  a.attending_doctor_id, 'SENIOR_DOCTOR'::role_name, a.department_id,
  1, false,
  a.admission_date + ((s * 9) || ' hours')::interval,
  a.admission_date + ((s * 9) || ' hours')::interval
FROM admissions a, generate_series(1, 8) s
WHERE a.admission_number LIKE 'ADM-%';

-- ---------------------------------------------------- investigation orders --
INSERT INTO investigation_orders (order_number, patient_id, admission_id, category, panel, priority, status, department_id, ordered_by_id, ordered_at, completed_at, created_at)
SELECT
  'LABP-' || lpad((row_number() OVER ())::text, 9, '0'),
  a.patient_id, a.id, 'LAB'::investigation_category,
  (ARRAY['Full blood count','Urea and electrolytes','Liver function','Troponin','C-reactive protein'])[1 + (s % 5)],
  (ARRAY['ROUTINE','ROUTINE','URGENT','STAT'])[1 + (s % 4)]::order_priority,
  (ARRAY['ORDERED','IN_PROGRESS','COMPLETED','COMPLETED'])[1 + (s % 4)]::order_status,
  a.department_id, a.attending_doctor_id,
  a.admission_date + ((s * 11) || ' hours')::interval,
  CASE WHEN s % 4 >= 2 THEN a.admission_date + ((s * 11 + 3) || ' hours')::interval END,
  a.admission_date + ((s * 11) || ' hours')::interval
FROM admissions a, generate_series(1, 6) s
WHERE a.admission_number LIKE 'ADM-%';

-- ------------------------------------------------------- medication orders --
INSERT INTO medication_orders (patient_id, admission_id, medicine_name, dose, frequency, route, start_date, prescriber_id, status, created_at, updated_at)
SELECT
  a.patient_id, a.id,
  (ARRAY['Paracetamol 500 mg','Amoxicillin 500 mg','Furosemide 40 mg','Ramipril 5 mg','Enoxaparin 40 mg'])[1 + (s % 5)],
  '1 tablet', 'Twice daily', 'ORAL'::medication_route,
  a.admission_date + ((s * 6) || ' hours')::interval,
  a.attending_doctor_id,
  (ARRAY['ACTIVE','ACTIVE','DISPENSED','STOPPED'])[1 + (s % 4)]::medication_status,
  a.admission_date, a.admission_date
FROM admissions a, generate_series(1, 5) s
WHERE a.admission_number LIKE 'ADM-%';

-- --------------------------------------------------------------- referrals --
INSERT INTO referrals (referral_number, patient_id, admission_id, referring_doctor_id, specialist_doctor_id, from_department_id, to_department_id, reason, clinical_summary, priority, status, created_at, updated_at)
SELECT
  'REFP-' || lpad((row_number() OVER ())::text, 9, '0'),
  a.patient_id, a.id, a.attending_doctor_id, sp.id, a.department_id, td.id,
  'Specialist opinion requested', repeat('Synthetic summary. ', 8),
  (ARRAY['ROUTINE','URGENT','EMERGENCY'])[1 + (s % 3)]::referral_priority,
  (ARRAY['PENDING','ACCEPTED','IN_PROGRESS','COMPLETED','DECLINED'])[1 + (s % 5)]::referral_status,
  a.admission_date + ((s * 17) || ' hours')::interval,
  a.admission_date + ((s * 17) || ' hours')::interval
FROM admissions a
CROSS JOIN generate_series(1, 2) s
CROSS JOIN LATERAL (SELECT id FROM users WHERE primary_role = 'SENIOR_DOCTOR' ORDER BY md5(a.id::text || s::text || id::text) LIMIT 1) sp
CROSS JOIN LATERAL (SELECT id FROM departments ORDER BY md5(a.id::text || s::text || id::text) LIMIT 1) td
WHERE a.admission_number LIKE 'ADM-%';

-- -------------------------------------------------------------- audit logs --
INSERT INTO audit_logs (user_id, actor_email, actor_role, action, entity_type, entity_id, patient_id, outcome, created_at)
SELECT
  a.attending_doctor_id, 'profile@caresync.local', 'SENIOR_DOCTOR'::role_name,
  (ARRAY['patient.read','patient.update','note.create','referral.create','patient.access_denied'])[1 + (s % 5)],
  'patient', a.patient_id::text, a.patient_id,
  (CASE WHEN s % 5 = 4 THEN 'DENIED' ELSE 'SUCCESS' END),
  a.admission_date + ((s * 23) || ' minutes')::interval
FROM admissions a, generate_series(1, 12) s
WHERE a.admission_number LIKE 'ADM-%';

-- ------------------------------------------------------------ notifications --
INSERT INTO notifications (recipient_id, patient_id, type, title, message, severity, read, created_at)
SELECT
  a.attending_doctor_id, a.patient_id,
  (ARRAY['REFERRAL_CREATED','CRITICAL_LAB_RESULT','VITALS_RECORDED','MESSAGE_RECEIVED'])[1 + (s % 4)]::notification_type,
  'Notification ' || s, 'Synthetic profiling row.',
  (ARRAY['INFO','ATTENTION','CRITICAL'])[1 + (s % 3)]::event_severity,
  (s % 3 = 0),
  a.admission_date + ((s * 31) || ' minutes')::interval
FROM admissions a, generate_series(1, 6) s
WHERE a.admission_number LIKE 'ADM-%';

ANALYZE;
