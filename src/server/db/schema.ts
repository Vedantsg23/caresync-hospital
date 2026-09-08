/**
 * CareSync Hospital — PostgreSQL schema (Drizzle ORM)
 * "One Hospital. One Connected View of the Patient."
 *
 * Design principles
 *  - Every clinical row is attributable: author + timestamp + audit entry.
 *  - Clinical records are versioned / retired, never hard-deleted.
 *  - `timeline_events` is an append-only projection giving the patient profile
 *    one chronological, paginated feed spanning every department.
 *  - `patient_access_grants` implements patient-level access on top of RBAC:
 *    accepting a referral grants the specialist scoped access to that patient.
 */
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';

/** Portable binary column for the `database` storage driver. */
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/* ------------------------------------------------------------------ enums */

export const roleNameEnum = pgEnum('role_name', [
  'SUPER_ADMIN', 'HOSPITAL_ADMIN', 'SENIOR_DOCTOR', 'JUNIOR_DOCTOR',
  'NURSE', 'RADIOLOGY', 'PATHOLOGY', 'PHARMACY', 'HR_ADMIN',
]);

/**
 * Account lifecycle. Registration is self-service but privilege is not: a new
 * clinical account lands in PENDING_APPROVAL and can do nothing until an
 * administrator assigns its role and department. There is no path from the
 * public registration form to a privileged role.
 */
export const accountStatusEnum = pgEnum('account_status', [
  'PENDING_VERIFICATION', 'PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DEACTIVATED',
]);

/** Single-use, hashed, expiring tokens. The plaintext never reaches the database. */
export const tokenPurposeEnum = pgEnum('token_purpose', [
  'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'STAFF_INVITATION',
]);

export const genderEnum = pgEnum('gender', ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']);
export const bloodGroupEnum = pgEnum('blood_group', [
  'A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE',
  'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN',
]);
export const patientStatusEnum = pgEnum('patient_status', ['STABLE', 'NEEDS_ATTENTION', 'CRITICAL']);
export const admissionStatusEnum = pgEnum('admission_status', ['ADMITTED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED']);
export const bedStatusEnum = pgEnum('bed_status', ['AVAILABLE', 'OCCUPIED', 'CLEANING', 'RESERVED']);
export const encounterTypeEnum = pgEnum('encounter_type', [
  'CONSULTATION', 'FOLLOW_UP', 'EMERGENCY', 'INPATIENT', 'SPECIALIST_CONSULTATION',
]);
export const encounterStatusEnum = pgEnum('encounter_status', ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const careTeamRoleEnum = pgEnum('care_team_role', [
  'ATTENDING', 'CONSULTING', 'SPECIALIST', 'RESIDENT', 'PRIMARY_NURSE', 'NURSE',
]);
export const noteTypeEnum = pgEnum('note_type', [
  'ADMISSION', 'PROGRESS', 'CONSULTATION', 'NURSING', 'SPECIALIST', 'DISCHARGE',
]);
export const investigationCategoryEnum = pgEnum('investigation_category', ['LAB', 'RADIOLOGY']);
export const orderPriorityEnum = pgEnum('order_priority', ['ROUTINE', 'URGENT', 'STAT']);
export const orderStatusEnum = pgEnum('order_status', ['ORDERED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const resultFlagEnum = pgEnum('result_flag', [
  'NORMAL', 'LOW', 'HIGH', 'CRITICAL_LOW', 'CRITICAL_HIGH', 'ABNORMAL',
]);
export const modalityEnum = pgEnum('modality', ['XRAY', 'CT', 'MRI', 'ULTRASOUND', 'OTHER']);
export const studyStatusEnum = pgEnum('study_status', ['ORDERED', 'SCHEDULED', 'IN_PROGRESS', 'REPORTED', 'CANCELLED']);
export const medicationStatusEnum = pgEnum('medication_status', [
  'PENDING', 'ACTIVE', 'STOPPED', 'COMPLETED', 'PENDING_DISPENSING', 'DISPENSED',
]);
export const medicationRouteEnum = pgEnum('medication_route', [
  'ORAL', 'IV', 'IM', 'SUBCUTANEOUS', 'TOPICAL', 'INHALATION', 'SUBLINGUAL', 'RECTAL', 'OTHER',
]);
export const referralPriorityEnum = pgEnum('referral_priority', ['ROUTINE', 'URGENT', 'EMERGENCY']);
export const referralStatusEnum = pgEnum('referral_status', [
  'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'REQUESTED_INFORMATION', 'COMPLETED', 'DECLINED', 'CANCELLED',
]);
export const notificationTypeEnum = pgEnum('notification_type', [
  'REFERRAL_CREATED', 'REFERRAL_ACCEPTED', 'REFERRAL_DECLINED', 'REFERRAL_INFORMATION_REQUESTED',
  'REFERRAL_RESPONSE', 'REFERRAL_COMPLETED', 'CRITICAL_LAB_RESULT', 'LAB_RESULT_AVAILABLE',
  'RADIOLOGY_REPORT_AVAILABLE', 'VITALS_RECORDED', 'MEDICATION_UPDATED', 'MEDICATION_DISPENSED',
  'PATIENT_ADMITTED', 'PATIENT_TRANSFERRED', 'MESSAGE_RECEIVED', 'SYSTEM',
]);
export const timelineEventTypeEnum = pgEnum('timeline_event_type', [
  'ADMISSION_CREATED', 'PATIENT_TRANSFERRED', 'PATIENT_DISCHARGED', 'ENCOUNTER_STARTED',
  'CLINICAL_NOTE', 'VITALS_RECORDED', 'OBSERVATION_RECORDED', 'INVESTIGATION_ORDERED',
  'LAB_RESULT', 'RADIOLOGY_REPORT', 'MEDICATION_ORDERED', 'MEDICATION_UPDATED',
  'MEDICATION_ADMINISTERED', 'REFERRAL_CREATED', 'REFERRAL_ACCEPTED', 'REFERRAL_DECLINED',
  'REFERRAL_INFORMATION_REQUESTED', 'REFERRAL_RESPONSE', 'REFERRAL_COMPLETED',
  'AI_SUMMARY', 'DOCUMENT_UPLOADED',
]);
export const eventSeverityEnum = pgEnum('event_severity', ['INFO', 'ATTENTION', 'CRITICAL']);
export const aiSummaryKindEnum = pgEnum('ai_summary_kind', [
  'PATIENT_SUMMARY', 'TIMELINE_SUMMARY', 'LAB_SUMMARY', 'RADIOLOGY_SUMMARY',
  'HANDOVER_SUMMARY', 'REFERRAL_BRIEF',
]);
export const accessGrantReasonEnum = pgEnum('access_grant_reason', [
  'REFERRAL', 'CARE_TEAM', 'DEPARTMENT_ORDER', 'ADMIN_GRANT', 'EMERGENCY_ACCESS',
]);

/* ------------------------------------------------- identity & access ---- */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  primaryRole: roleNameEnum('primary_role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  mustReset: boolean('must_reset').notNull().default(false),

  /* --- production account lifecycle ------------------------------------ */
  /** Where this account is in the registration -> approval -> active path. */
  status: accountStatusEnum('status').notNull().default('ACTIVE'),
  phone: text('phone'),
  /** Set once the holder proves they control the address. Null = unverified. */
  emailVerifiedAt: ts('email_verified_at'),
  /** Who let this account into the hospital, and when. */
  approvedById: uuid('approved_by_id'),
  approvedAt: ts('approved_at'),
  rejectionReason: text('rejection_reason'),
  /** What the applicant asked to be. Never trusted as the granted role. */
  requestedRole: roleNameEnum('requested_role'),
  requestedDepartmentId: uuid('requested_department_id'),
  /** Free-text professional detail supplied at registration, for the approver. */
  registrationNote: text('registration_note'),
  lastLoginIp: text('last_login_ip'),
  passwordChangedAt: ts('password_changed_at'),

  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_email_key').on(t.email),
  index('users_primary_role_idx').on(t.primaryRole),
  index('users_is_active_idx').on(t.isActive),
  index('users_status_idx').on(t.status),
  index('users_pending_approval_idx').on(t.status, t.createdAt),
]);

/**
 * Email verification, password reset and staff invitations.
 *
 * Only a SHA-256 hash of the token is stored, so a database read cannot be
 * replayed as a valid link. Tokens are single-use (`consumedAt`) and expire.
 */
export const verificationTokens = pgTable('verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Invitations exist before any user row does, so the address is carried here. */
  email: text('email').notNull(),
  purpose: tokenPurposeEnum('purpose').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  /** For invitations: the role and department the administrator is granting. */
  invitedRole: roleNameEnum('invited_role'),
  invitedDepartmentId: uuid('invited_department_id').references(() => departments.id),
  createdById: uuid('created_by_id').references(() => users.id),
  ipAddress: text('ip_address'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('verification_tokens_hash_key').on(t.tokenHash),
  index('verification_tokens_lookup_idx').on(t.email, t.purpose, t.consumedAt),
  index('verification_tokens_expiry_idx').on(t.expiresAt),
  index('verification_tokens_user_idx').on(t.userId),
]);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: roleNameEnum('name').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('roles_name_key').on(t.name)]);

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  description: text('description'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('permissions_code_key').on(t.code),
  index('permissions_category_idx').on(t.category),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  assignedAt: ts('assigned_at').notNull().defaultNow(),
  assignedById: uuid('assigned_by_id').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenId: text('token_id').notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  /** Set when this session replaced an earlier one, so rotation is traceable. */
  rotatedFromId: uuid('rotated_from_id'),
  absoluteExpiresAt: ts('absolute_expires_at'),
}, (t) => [
  uniqueIndex('sessions_token_id_key').on(t.tokenId),
  index('sessions_user_id_idx').on(t.userId),
  index('sessions_expires_at_idx').on(t.expiresAt),
  // The hot path on every authenticated request: this user's live sessions.
  index('sessions_active_idx').on(t.userId, t.revokedAt, t.expiresAt),
]);

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isClinical: boolean('is_clinical').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('departments_code_key').on(t.code)]);

export const staffProfiles = pgTable('staff_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  staffNumber: text('staff_number').notNull(),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  designation: text('designation').notNull(),
  specialization: text('specialization'),
  registrationNumber: text('registration_number'),
  phone: text('phone'),
  acceptsReferrals: boolean('accepts_referrals').notNull().default(false),
  bio: text('bio'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('staff_profiles_user_id_key').on(t.userId),
  uniqueIndex('staff_profiles_staff_number_key').on(t.staffNumber),
  index('staff_profiles_department_idx').on(t.departmentId),
  index('staff_profiles_accepts_referrals_idx').on(t.acceptsReferrals),
]);

/* ------------------------------------------------------------ patients -- */

export const patients = pgTable('patients', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientNumber: text('patient_number').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  dateOfBirth: date('date_of_birth', { mode: 'date' }).notNull(),
  gender: genderEnum('gender').notNull(),
  bloodGroup: bloodGroupEnum('blood_group').notNull().default('UNKNOWN'),
  phone: text('phone'),
  email: text('email'),
  addressLine: text('address_line'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  allergies: text('allergies').array().notNull().default([]),
  chronicConditions: text('chronic_conditions').array().notNull().default([]),
  status: patientStatusEnum('status').notNull().default('STABLE'),
  notes: text('notes'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('patients_patient_number_key').on(t.patientNumber),
  index('patients_name_idx').on(t.lastName, t.firstName),
  index('patients_status_idx').on(t.status),
]);

export const patientContacts = pgTable('patient_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relationship: text('relationship').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('patient_contacts_patient_idx').on(t.patientId)]);

export const patientAccessGrants = pgTable('patient_access_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: accessGrantReasonEnum('reason').notNull(),
  justification: text('justification'),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  grantedById: uuid('granted_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
}, (t) => [
  index('patient_access_grants_patient_user_idx').on(t.patientId, t.userId),
  index('patient_access_grants_user_idx').on(t.userId),
]);

/* ------------------------------------------------------- wards / beds --- */

export const wards = pgTable('wards', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  floor: text('floor'),
  isCritical: boolean('is_critical').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('wards_code_key').on(t.code),
  index('wards_department_idx').on(t.departmentId),
]);

export const beds = pgTable('beds', {
  id: uuid('id').primaryKey().defaultRandom(),
  wardId: uuid('ward_id').notNull().references(() => wards.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  status: bedStatusEnum('status').notNull().default('AVAILABLE'),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('beds_ward_code_key').on(t.wardId, t.code),
  index('beds_status_idx').on(t.status),
]);

/* --------------------------------------------- admissions & encounters -- */

export const admissions = pgTable('admissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionNumber: text('admission_number').notNull(),
  admissionDate: ts('admission_date').notNull().defaultNow(),
  dischargeDate: ts('discharge_date'),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  wardId: uuid('ward_id').references(() => wards.id, { onDelete: 'set null' }),
  bedId: uuid('bed_id').references(() => beds.id, { onDelete: 'set null' }),
  attendingDoctorId: uuid('attending_doctor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  status: admissionStatusEnum('status').notNull().default('ADMITTED'),
  dischargeSummary: text('discharge_summary'),
  createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('admissions_number_key').on(t.admissionNumber),
  index('admissions_patient_idx').on(t.patientId),
  index('admissions_status_idx').on(t.status),
  index('admissions_attending_idx').on(t.attendingDoctorId),
  index('admissions_department_idx').on(t.departmentId),
]);

export const admissionTransfers = pgTable('admission_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  admissionId: uuid('admission_id').notNull().references(() => admissions.id, { onDelete: 'cascade' }),
  fromWardId: uuid('from_ward_id').references(() => wards.id, { onDelete: 'set null' }),
  fromBedId: uuid('from_bed_id').references(() => beds.id, { onDelete: 'set null' }),
  toWardId: uuid('to_ward_id').references(() => wards.id, { onDelete: 'set null' }),
  toBedId: uuid('to_bed_id').references(() => beds.id, { onDelete: 'set null' }),
  reason: text('reason'),
  performedById: uuid('performed_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  transferredAt: ts('transferred_at').notNull().defaultNow(),
}, (t) => [index('admission_transfers_admission_idx').on(t.admissionId)]);

export const encounters = pgTable('encounters', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterType: encounterTypeEnum('encounter_type').notNull(),
  departmentId: uuid('department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  providerId: uuid('provider_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  startTime: ts('start_time').notNull().defaultNow(),
  endTime: ts('end_time'),
  status: encounterStatusEnum('status').notNull().default('IN_PROGRESS'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('encounters_patient_idx').on(t.patientId),
  index('encounters_provider_idx').on(t.providerId),
  index('encounters_admission_idx').on(t.admissionId),
]);

export const careTeamMembers = pgTable('care_team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: careTeamRoleEnum('role').notNull(),
  assignedById: uuid('assigned_by_id').references(() => users.id, { onDelete: 'set null' }),
  assignedAt: ts('assigned_at').notNull().defaultNow(),
  removedAt: ts('removed_at'),
}, (t) => [
  index('care_team_patient_idx').on(t.patientId),
  index('care_team_user_idx').on(t.userId),
]);

/* --------------------------------------------------- clinical records --- */

export const clinicalNotes = pgTable('clinical_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  noteType: noteTypeEnum('note_type').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  authorRole: roleNameEnum('author_role').notNull(),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  isRetired: boolean('is_retired').notNull().default(false),
  retiredAt: ts('retired_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('clinical_notes_patient_idx').on(t.patientId, t.createdAt),
  index('clinical_notes_type_idx').on(t.noteType),
]);

export const clinicalNoteVersions = pgTable('clinical_note_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  noteId: uuid('note_id').notNull().references(() => clinicalNotes.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  changeNote: text('change_note'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('clinical_note_versions_key').on(t.noteId, t.version)]);

export const vitalSigns = pgTable('vital_signs', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  temperatureC: doublePrecision('temperature_c'),
  heartRate: integer('heart_rate'),
  bloodPressureSystolic: integer('blood_pressure_systolic'),
  bloodPressureDiastolic: integer('blood_pressure_diastolic'),
  spo2: integer('spo2'),
  respiratoryRate: integer('respiratory_rate'),
  painScore: integer('pain_score'),
  bloodGlucose: doublePrecision('blood_glucose'),
  newsScore: integer('news_score'),
  isAbnormal: boolean('is_abnormal').notNull().default(false),
  notes: text('notes'),
  recordedById: uuid('recorded_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('vital_signs_patient_idx').on(t.patientId, t.recordedAt)]);

export const observations = pgTable('observations', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  category: text('category').notNull(),
  content: text('content').notNull(),
  severity: eventSeverityEnum('severity').notNull().default('INFO'),
  recordedById: uuid('recorded_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
}, (t) => [index('observations_patient_idx').on(t.patientId, t.recordedAt)]);

/* ------------------------------------- investigations (lab + radiology) - */

export const investigations = pgTable('investigations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  category: investigationCategoryEnum('category').notNull(),
  panel: text('panel'),
  unit: text('unit'),
  referenceLow: doublePrecision('reference_low'),
  referenceHigh: doublePrecision('reference_high'),
  criticalLow: doublePrecision('critical_low'),
  criticalHigh: doublePrecision('critical_high'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('investigations_code_key').on(t.code),
  index('investigations_category_idx').on(t.category),
  index('investigations_panel_idx').on(t.panel),
]);

export const investigationOrders = pgTable('investigation_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: text('order_number').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  category: investigationCategoryEnum('category').notNull(),
  panel: text('panel').notNull(),
  clinicalInfo: text('clinical_info'),
  priority: orderPriorityEnum('priority').notNull().default('ROUTINE'),
  status: orderStatusEnum('status').notNull().default('ORDERED'),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  orderedById: uuid('ordered_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  orderedAt: ts('ordered_at').notNull().defaultNow(),
  collectedAt: ts('collected_at'),
  completedAt: ts('completed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('investigation_orders_number_key').on(t.orderNumber),
  index('investigation_orders_patient_idx').on(t.patientId, t.orderedAt),
  index('investigation_orders_status_idx').on(t.status),
  index('investigation_orders_category_idx').on(t.category),
]);

export const investigationResults = pgTable('investigation_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => investigationOrders.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  investigationId: uuid('investigation_id').references(() => investigations.id, { onDelete: 'set null' }),
  analyte: text('analyte').notNull(),
  value: text('value').notNull(),
  numericValue: doublePrecision('numeric_value'),
  unit: text('unit'),
  referenceRange: text('reference_range'),
  flag: resultFlagEnum('flag').notNull().default('NORMAL'),
  comment: text('comment'),
  resultedById: uuid('resulted_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  resultedAt: ts('resulted_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('investigation_results_patient_idx').on(t.patientId, t.resultedAt),
  index('investigation_results_order_idx').on(t.orderId),
  index('investigation_results_flag_idx').on(t.flag),
]);

export const radiologyStudies = pgTable('radiology_studies', {
  id: uuid('id').primaryKey().defaultRandom(),
  accessionNumber: text('accession_number').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  orderId: uuid('order_id').references(() => investigationOrders.id, { onDelete: 'set null' }),
  modality: modalityEnum('modality').notNull(),
  bodyPart: text('body_part').notNull(),
  description: text('description').notNull(),
  clinicalInfo: text('clinical_info'),
  contrastUsed: boolean('contrast_used').notNull().default(false),
  priority: orderPriorityEnum('priority').notNull().default('ROUTINE'),
  status: studyStatusEnum('status').notNull().default('ORDERED'),
  requestedById: uuid('requested_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  performedAt: ts('performed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('radiology_studies_accession_key').on(t.accessionNumber),
  index('radiology_studies_patient_idx').on(t.patientId, t.requestedAt),
  index('radiology_studies_status_idx').on(t.status),
]);

export const radiologyReports = pgTable('radiology_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  studyId: uuid('study_id').notNull().references(() => radiologyStudies.id, { onDelete: 'cascade' }),
  findings: text('findings').notNull(),
  impression: text('impression').notNull(),
  recommendation: text('recommendation'),
  isCritical: boolean('is_critical').notNull().default(false),
  radiologistId: uuid('radiologist_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reportedAt: ts('reported_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('radiology_reports_study_idx').on(t.studyId)]);

/* ----------------------------------------------------------- pharmacy --- */

export const medications = pgTable('medications', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  genericName: text('generic_name'),
  form: text('form').notNull(),
  strength: text('strength'),
  category: text('category'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('medications_code_key').on(t.code),
  index('medications_name_idx').on(t.name),
]);

export const medicationOrders = pgTable('medication_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  medicationId: uuid('medication_id').references(() => medications.id, { onDelete: 'set null' }),
  medicineName: text('medicine_name').notNull(),
  dose: text('dose').notNull(),
  frequency: text('frequency').notNull(),
  route: medicationRouteEnum('route').notNull(),
  instructions: text('instructions'),
  startDate: ts('start_date').notNull(),
  endDate: ts('end_date'),
  prescriberId: uuid('prescriber_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: medicationStatusEnum('status').notNull().default('PENDING'),
  stopReason: text('stop_reason'),
  dispensedById: uuid('dispensed_by_id').references(() => users.id, { onDelete: 'set null' }),
  dispensedAt: ts('dispensed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('medication_orders_patient_idx').on(t.patientId),
  index('medication_orders_status_idx').on(t.status),
]);

export const medicationAdministrations = pgTable('medication_administrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  medicationOrderId: uuid('medication_order_id').notNull().references(() => medicationOrders.id, { onDelete: 'cascade' }),
  administeredById: uuid('administered_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  administeredAt: ts('administered_at').notNull().defaultNow(),
  doseGiven: text('dose_given').notNull(),
  wasWithheld: boolean('was_withheld').notNull().default(false),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('medication_administrations_order_idx').on(t.medicationOrderId)]);

/* ---------------------------------------------------------- referrals --- */

export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey().defaultRandom(),
  referralNumber: text('referral_number').notNull(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  referringDoctorId: uuid('referring_doctor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  specialistDoctorId: uuid('specialist_doctor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  fromDepartmentId: uuid('from_department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  toDepartmentId: uuid('to_department_id').notNull().references(() => departments.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  clinicalSummary: text('clinical_summary').notNull(),
  symptoms: text('symptoms'),
  relevantHistory: text('relevant_history'),
  relevantInvestigations: text('relevant_investigations'),
  currentMedications: text('current_medications'),
  priority: referralPriorityEnum('priority').notNull().default('ROUTINE'),
  status: referralStatusEnum('status').notNull().default('PENDING'),
  informationRequest: text('information_request'),
  informationResponse: text('information_response'),
  declineReason: text('decline_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  acceptedAt: ts('accepted_at'),
  respondedAt: ts('responded_at'),
  completedAt: ts('completed_at'),
}, (t) => [
  uniqueIndex('referrals_number_key').on(t.referralNumber),
  index('referrals_specialist_status_idx').on(t.specialistDoctorId, t.status),
  index('referrals_referring_status_idx').on(t.referringDoctorId, t.status),
  index('referrals_patient_idx').on(t.patientId),
  index('referrals_status_idx').on(t.status),
]);

export const referralResponses = pgTable('referral_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  referralId: uuid('referral_id').notNull().references(() => referrals.id, { onDelete: 'cascade' }),
  assessment: text('assessment').notNull(),
  findings: text('findings').notNull(),
  recommendations: text('recommendations').notNull(),
  treatmentPlan: text('treatment_plan').notNull(),
  followUp: text('follow_up'),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  isFinal: boolean('is_final').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('referral_responses_referral_idx').on(t.referralId)]);

/* --------------------------------------------- notifications & comms ---- */

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: uuid('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  link: text('link'),
  severity: eventSeverityEnum('severity').notNull().default('INFO'),
  read: boolean('read').notNull().default(false),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('notifications_recipient_idx').on(t.recipientId, t.read, t.createdAt)]);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  subject: text('subject').notNull(),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  createdById: uuid('created_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  lastMessageAt: ts('last_message_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('conversations_patient_idx').on(t.patientId)]);

export const conversationParticipants = pgTable('conversation_participants', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  joinedAt: ts('joined_at').notNull().defaultNow(),
  lastReadAt: ts('last_read_at'),
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  index('conversation_participants_user_idx').on(t.userId),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  body: text('body').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)]);

/* -------------------------------------------- files, audit, timeline, ai  */

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'cascade' }),
  referralId: uuid('referral_id').references(() => referrals.id, { onDelete: 'set null' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  category: text('category').notNull(),
  storageDriver: text('storage_driver').notNull(),
  storagePath: text('storage_path').notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  uploadedById: uuid('uploaded_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('attachments_patient_idx').on(t.patientId)]);

/** Portable storage driver: keeps documents in Postgres so the platform runs
 *  anywhere. Set STORAGE_DRIVER=supabase to use object storage instead. */
export const fileBlobs = pgTable('file_blobs', {
  attachmentId: uuid('attachment_id').primaryKey().references(() => attachments.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Append-only. Application code has no UPDATE or DELETE path; enforced by
 *  a database rule in migration 0001. */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  actorRole: roleNameEnum('actor_role'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id'),
  patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'set null' }),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  outcome: text('outcome').notNull().default('SUCCESS'),
  metadata: jsonb('metadata'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('audit_logs_patient_idx').on(t.patientId, t.createdAt),
  index('audit_logs_user_idx').on(t.userId, t.createdAt),
  index('audit_logs_action_idx').on(t.action),
  index('audit_logs_created_idx').on(t.createdAt),
]);

export const timelineEvents = pgTable('timeline_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'set null' }),
  encounterId: uuid('encounter_id').references(() => encounters.id, { onDelete: 'set null' }),
  eventType: timelineEventTypeEnum('event_type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  severity: eventSeverityEnum('severity').notNull().default('INFO'),
  metadata: jsonb('metadata'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('timeline_events_patient_idx').on(t.patientId, t.occurredAt),
  index('timeline_events_type_idx').on(t.eventType),
]);

export const aiSummaries = pgTable('ai_summaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.id, { onDelete: 'cascade' }),
  kind: aiSummaryKindEnum('kind').notNull(),
  content: text('content').notNull(),
  keyPoints: text('key_points').array().notNull().default([]),
  provider: text('provider').notNull(),
  model: text('model'),
  inputDigest: text('input_digest'),
  requestedById: uuid('requested_by_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reviewed: boolean('reviewed').notNull().default(false),
  reviewedById: uuid('reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: ts('reviewed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('ai_summaries_patient_idx').on(t.patientId, t.createdAt)]);
