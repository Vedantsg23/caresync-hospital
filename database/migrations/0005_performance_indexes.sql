-- 0005 — indexes and expression fixes driven by EXPLAIN ANALYZE.
--
-- Every index here was added because a captured plan showed the cost, and the
-- measurement is recorded in docs/PERFORMANCE.md. The dataset was 50,027
-- patients, 30,027 admissions, 1,201,302 timeline events and 600,698
-- observations — enough that the planner stops choosing a sequential scan
-- because it is genuinely cheaper.
--
-- Additive and idempotent. No table is rewritten and no data is changed.

/* ------------------------------------------------------------------ 1 ----
 * The hospital activity feed sorted the entire timeline on disk.
 *
 *   Sort Method: external merge  Disk: 50752kB
 *   Parallel Seq Scan on timeline_events  rows=400434 (x3 workers)
 *
 * Twelve rows were wanted. Ordering by occurred_at with no index means reading
 * 1.2m rows, spilling ~150MB across three workers and sorting them, every time
 * a dashboard loads. A descending index on the ordering column turns that into
 * an ordered scan that stops after it has the rows it needs.
 */
CREATE INDEX IF NOT EXISTS timeline_events_occurred_idx
  ON timeline_events (occurred_at DESC);

/* ------------------------------------------------------------------ 2 ----
 * Patient visibility, in the direction it is actually asked.
 *
 * `patientVisibilityFilter` asks "which patients does THIS user reach", so the
 * leading column has to be the user. The existing unique index on
 * (patient_id, user_id) answers the opposite question and cannot serve this
 * one. The same applies to admissions: attending_doctor_id is indexed, but
 * including patient_id lets the EXISTS be satisfied from the index alone.
 */
CREATE INDEX IF NOT EXISTS care_team_user_patient_active_idx
  ON care_team_members (user_id, patient_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS admissions_attending_patient_idx
  ON admissions (attending_doctor_id, patient_id);

CREATE INDEX IF NOT EXISTS encounters_provider_patient_idx
  ON encounters (provider_id, patient_id);

/* ------------------------------------------------------------------ 3 ----
 * Search by admission number.
 *
 *   Seq Scan on admissions sa  (actual time=21.982..21.983 rows=0)
 *   Filter: (lower(admission_number) ~~ '%sharma%')
 *   Rows Removed by Filter: 30027
 *
 * There is a btree index on lower(admission_number), and a leading-wildcard
 * LIKE cannot use it — a btree can find a prefix, not an infix. Trigram can.
 */
CREATE INDEX IF NOT EXISTS admissions_number_trgm
  ON admissions USING gin (lower(admission_number) gin_trgm_ops);

/* ------------------------------------------------------------------ 4 ----
 * A trigram index that indexed an expression no query asked for.
 *
 * patients_search_trgm covers
 *   lower(first_name || ' ' || last_name || ' ' || patient_number)
 * while the search filtered on three different expressions — first||last,
 * last||first, and patient_number on its own. None of them matched, so the
 * index was never used and every search sequentially scanned 50,027 patients
 * (109ms for the page, another 379ms for the count).
 *
 * The fix is in the query, not here: searchPatients now matches the indexed
 * expression exactly, one token at a time, which also makes "Sharma Priya"
 * and "Priya PS-0004" work — neither did before. This index is left in place
 * and is now the one the plan uses; the reversed-name index the old query
 * would have needed is not created, because tokenising removed the need for
 * it. Recorded here so the next person does not "restore" the old predicate.
 */

/* ------------------------------------------------------------------ 5 ----
 * Worklists filter by status and order by time. The status indexes exist; the
 * ordering columns do not, so a busy department's worklist sorts its whole
 * result. Composite, in the order the query uses them.
 */
CREATE INDEX IF NOT EXISTS investigation_orders_status_ordered_idx
  ON investigation_orders (status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS medication_orders_status_created_idx
  ON medication_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS radiology_studies_status_requested_idx
  ON radiology_studies (status, requested_at DESC);

/* ------------------------------------------------------------------ 6 ----
 * Referral inboxes are read constantly and ordered newest first.
 */
CREATE INDEX IF NOT EXISTS referrals_specialist_created_idx
  ON referrals (specialist_doctor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS referrals_referring_created_idx
  ON referrals (referring_doctor_id, created_at DESC);

/* ------------------------------------------------------------------ 7 ----
 * The audit trail is paged by a created_at cursor, newest first, and it is the
 * table that grows fastest of all of them.
 */
CREATE INDEX IF NOT EXISTS audit_logs_created_desc_idx
  ON audit_logs (created_at DESC);

ANALYZE;

/* ------------------------------------------------------------------ 8 ----
 * The referral inbox, ordered the way it is read.
 *
 * The inbox sorts by priority then recency. That was written as a CASE
 * expression, which no index can satisfy, so answering it meant reading every
 * referral addressed to the specialist — 9,901 rows at roughly 845 bytes each,
 * clinical summaries included — to return fifty of them.
 *
 * `referral_priority` is declared ROUTINE, URGENT, EMERGENCY, so the enum's own
 * descending order already means "emergencies first". The service now orders by
 * the column, and these two indexes return the rows already sorted.
 */
CREATE INDEX IF NOT EXISTS referrals_specialist_priority_created_idx
  ON referrals (specialist_doctor_id, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS referrals_referring_priority_created_idx
  ON referrals (referring_doctor_id, priority DESC, created_at DESC);

ANALYZE referrals;
