import { z } from 'zod';
import { ROLES } from '@/types/rbac';

/** Every mutating endpoint validates against one of these. The same schemas
 *  are re-used by the client forms, so front and back end can never drift. */

export const uuid = z.string().uuid('Must be a valid identifier');
const nonEmpty = (label: string, max = 5000) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

/* --------------------------------------------------------------- auth --- */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(10, 'New password must be at least 10 characters').max(200),
});

/* ------------------------------------------------------------ patients -- */

export const genderSchema = z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']);
export const bloodGroupSchema = z.enum([
  'A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE',
  'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN',
]);
export const patientStatusSchema = z.enum(['STABLE', 'NEEDS_ATTENTION', 'CRITICAL']);

const dateOnly = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Enter a valid date');

export const createPatientSchema = z.object({
  firstName: nonEmpty('First name', 120),
  lastName: nonEmpty('Last name', 120),
  dateOfBirth: dateOnly.refine((d) => d <= new Date(), 'Date of birth cannot be in the future')
    .refine((d) => d > new Date('1900-01-01'), 'Enter a valid date of birth'),
  gender: genderSchema,
  bloodGroup: bloodGroupSchema.optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  addressLine: z.string().trim().max(300).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  state: z.string().trim().max(120).optional().or(z.literal('')),
  postalCode: z.string().trim().max(20).optional().or(z.literal('')),
  allergies: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  chronicConditions: z.array(z.string().trim().min(1).max(160)).max(40).optional(),
  emergencyContact: z.object({
    name: nonEmpty('Contact name', 160),
    relationship: nonEmpty('Relationship', 80),
    phone: nonEmpty('Contact phone', 40),
    email: z.string().trim().email().optional().or(z.literal('')),
  }).optional(),
});

export const updatePatientSchema = createPatientSchema.partial().extend({
  status: patientStatusSchema.optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const patientSearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: patientStatusSchema.optional(),
  wardId: uuid.optional(),
  mineOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/* ---------------------------------------------------------- admissions -- */

export const createAdmissionSchema = z.object({
  patientId: uuid,
  departmentId: uuid,
  wardId: uuid.optional(),
  bedId: uuid.optional(),
  attendingDoctorId: uuid,
  reason: nonEmpty('Reason for admission', 500),
});

export const transferSchema = z.object({
  toWardId: uuid,
  toBedId: uuid.optional(),
  reason: z.string().trim().max(500).optional(),
});

export const dischargeSchema = z.object({
  summary: nonEmpty('Discharge summary', 8000),
});

export const createWardSchema = z.object({
  code: nonEmpty('Ward code', 24).transform((s) => s.toUpperCase()),
  name: nonEmpty('Ward name', 120),
  departmentId: uuid,
  floor: z.string().trim().max(40).optional(),
  isCritical: z.boolean().optional(),
});

export const createBedSchema = z.object({
  wardId: uuid,
  code: nonEmpty('Bed code', 24),
});

export const bedStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'OCCUPIED', 'CLEANING', 'RESERVED']),
});

/* ------------------------------------------------------------- vitals --- */

export const vitalsSchema = z.object({
  temperatureC: z.coerce.number().min(25, 'Temperature is implausibly low').max(45, 'Temperature is implausibly high').optional(),
  heartRate: z.coerce.number().int().min(10).max(300).optional(),
  bloodPressureSystolic: z.coerce.number().int().min(40).max(300).optional(),
  bloodPressureDiastolic: z.coerce.number().int().min(20).max(220).optional(),
  spo2: z.coerce.number().int().min(30).max(100).optional(),
  respiratoryRate: z.coerce.number().int().min(2).max(80).optional(),
  painScore: z.coerce.number().int().min(0).max(10).optional(),
  bloodGlucose: z.coerce.number().min(0.5).max(60).optional(),
  notes: z.string().trim().max(1000).optional(),
}).refine(
  (v) => Object.entries(v).some(([k, val]) => k !== 'notes' && val !== undefined),
  { message: 'Record at least one observation value' },
).refine(
  (v) => v.bloodPressureSystolic === undefined || v.bloodPressureDiastolic === undefined
    || v.bloodPressureSystolic > v.bloodPressureDiastolic,
  { message: 'Systolic pressure must be higher than diastolic', path: ['bloodPressureSystolic'] },
);

export const observationSchema = z.object({
  category: nonEmpty('Category', 80),
  content: nonEmpty('Observation', 4000),
  severity: z.enum(['INFO', 'ATTENTION', 'CRITICAL']).optional(),
});

/* ------------------------------------------------------ clinical notes -- */

export const noteTypeSchema = z.enum(['ADMISSION', 'PROGRESS', 'CONSULTATION', 'NURSING', 'SPECIALIST', 'DISCHARGE']);

export const createNoteSchema = z.object({
  noteType: noteTypeSchema,
  title: nonEmpty('Title', 200),
  content: nonEmpty('Note content', 20000),
  encounterId: uuid.optional(),
});

export const updateNoteSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(20000).optional(),
  changeNote: z.string().trim().max(500).optional(),
}).refine((v) => v.title !== undefined || v.content !== undefined, {
  message: 'Provide a title or content to amend',
});

/* ---------------------------------------------------------- referrals --- */

export const referralPrioritySchema = z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']);
export const referralStatusSchema = z.enum([
  'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'REQUESTED_INFORMATION', 'COMPLETED', 'DECLINED', 'CANCELLED',
]);

export const createReferralSchema = z.object({
  patientId: uuid,
  specialistDoctorId: uuid,
  toDepartmentId: uuid.optional(),
  reason: nonEmpty('Reason for referral', 500),
  clinicalSummary: nonEmpty('Clinical summary', 8000),
  symptoms: z.string().trim().max(4000).optional(),
  relevantHistory: z.string().trim().max(4000).optional(),
  relevantInvestigations: z.string().trim().max(4000).optional(),
  currentMedications: z.string().trim().max(4000).optional(),
  priority: referralPrioritySchema.optional(),
  encounterId: uuid.optional(),
});

export const referralResponseSchema = z.object({
  assessment: nonEmpty('Assessment', 8000),
  findings: nonEmpty('Findings', 8000),
  recommendations: nonEmpty('Recommendations', 8000),
  treatmentPlan: nonEmpty('Treatment plan', 8000),
  followUp: z.string().trim().max(4000).optional(),
});

export const referralReasonSchema = z.object({ reason: nonEmpty('Reason', 2000) });
export const referralQuestionSchema = z.object({ question: nonEmpty('Question', 2000) });
export const referralAnswerSchema = z.object({ answer: nonEmpty('Response', 4000) });
export const referralCancelSchema = z.object({ reason: z.string().trim().max(2000).optional() });

export const referralListSchema = z.object({
  box: z.enum(['incoming', 'outgoing', 'all']).optional(),
  status: z.string().optional(),
  patientId: uuid.optional(),
  priority: referralPrioritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/* -------------------------------------------------------- diagnostics --- */

export const orderPrioritySchema = z.enum(['ROUTINE', 'URGENT', 'STAT']);

export const createLabOrderSchema = z.object({
  patientId: uuid,
  panel: nonEmpty('Panel', 160),
  clinicalInfo: z.string().trim().max(2000).optional(),
  priority: orderPrioritySchema.optional(),
  encounterId: uuid.optional(),
});

export const labResultsSchema = z.object({
  results: z.array(z.object({
    analyte: nonEmpty('Analyte', 120),
    value: nonEmpty('Value', 80),
    unit: z.string().trim().max(40).optional(),
    investigationCode: z.string().trim().max(40).optional(),
    comment: z.string().trim().max(500).optional(),
  })).min(1, 'Record at least one result').max(60),
});

export const modalitySchema = z.enum(['XRAY', 'CT', 'MRI', 'ULTRASOUND', 'OTHER']);

export const createStudySchema = z.object({
  patientId: uuid,
  modality: modalitySchema,
  bodyPart: nonEmpty('Body part', 120),
  description: nonEmpty('Description', 500),
  clinicalInfo: z.string().trim().max(2000).optional(),
  contrastUsed: z.boolean().optional(),
  priority: orderPrioritySchema.optional(),
  encounterId: uuid.optional(),
});

export const radiologyReportSchema = z.object({
  findings: nonEmpty('Findings', 12000),
  impression: nonEmpty('Impression', 4000),
  recommendation: z.string().trim().max(4000).optional(),
  isCritical: z.boolean().optional(),
});

export const studyStatusSchema = z.object({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'CANCELLED']),
});

/* ----------------------------------------------------------- pharmacy --- */

export const medicationRouteSchema = z.enum([
  'ORAL', 'IV', 'IM', 'SUBCUTANEOUS', 'TOPICAL', 'INHALATION', 'SUBLINGUAL', 'RECTAL', 'OTHER',
]);
export const medicationStatusSchema = z.enum([
  'PENDING', 'ACTIVE', 'STOPPED', 'COMPLETED', 'PENDING_DISPENSING', 'DISPENSED',
]);

export const prescribeSchema = z.object({
  patientId: uuid,
  medicationId: uuid.optional(),
  medicineName: nonEmpty('Medicine', 200),
  dose: nonEmpty('Dose', 80),
  frequency: nonEmpty('Frequency', 80),
  route: medicationRouteSchema,
  instructions: z.string().trim().max(1000).optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  encounterId: uuid.optional(),
}).refine((v) => !v.endDate || v.endDate >= v.startDate, {
  message: 'End date must be on or after the start date', path: ['endDate'],
});

export const medicationStatusUpdateSchema = z.object({
  status: medicationStatusSchema,
  stopReason: z.string().trim().max(1000).optional(),
});

export const administerSchema = z.object({
  doseGiven: nonEmpty('Dose given', 80),
  wasWithheld: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional(),
});

/* --------------------------------------------- messaging & care team ---- */

export const createConversationSchema = z.object({
  subject: nonEmpty('Subject', 200),
  participantIds: z.array(uuid).min(1, 'Select at least one recipient').max(20),
  patientId: uuid.optional(),
  firstMessage: z.string().trim().max(4000).optional(),
});

export const sendMessageSchema = z.object({
  body: nonEmpty('Message', 4000),
});

export const careTeamSchema = z.object({
  userId: uuid,
  role: z.enum(['ATTENDING', 'CONSULTING', 'SPECIALIST', 'RESIDENT', 'PRIMARY_NURSE', 'NURSE']),
});

/* -------------------------------------------------------------- admin --- */

export const roleSchema = z.enum(ROLES);

export const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  fullName: nonEmpty('Full name', 160),
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
  role: roleSchema,
  departmentId: uuid.optional(),
  designation: nonEmpty('Designation', 120),
  specialization: z.string().trim().max(120).optional(),
  registrationNumber: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(40).optional(),
  acceptsReferrals: z.boolean().optional(),
});

export const updateStaffSchema = z.object({
  fullName: z.string().trim().min(1).max(160).optional(),
  departmentId: uuid.nullable().optional(),
  designation: z.string().trim().min(1).max(120).optional(),
  specialization: z.string().trim().max(120).nullable().optional(),
  registrationNumber: z.string().trim().max(60).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  acceptsReferrals: z.boolean().optional(),
});

export const changeRoleSchema = z.object({ role: roleSchema });
export const setActiveSchema = z.object({ isActive: z.boolean() });
export const resetPasswordSchema = z.object({
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

export const createDepartmentSchema = z.object({
  code: nonEmpty('Code', 24),
  name: nonEmpty('Name', 120),
  description: z.string().trim().max(500).optional(),
  isClinical: z.boolean().optional(),
});

export const auditQuerySchema = z.object({
  patientId: uuid.optional(),
  userId: uuid.optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

/* ----------------------------------------------------------------- ai --- */

export const aiSummarySchema = z.object({
  patientId: uuid,
  kind: z.enum(['PATIENT_SUMMARY', 'TIMELINE_SUMMARY', 'LAB_SUMMARY', 'RADIOLOGY_SUMMARY', 'REFERRAL_BRIEF']).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});

/* ------------------------------------------------------------ generic --- */

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  types: z.string().optional(),
});

export const notificationQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listQuerySchema = z.object({
  patientId: uuid.optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter a search term').max(120),
});

export type CreatePatientPayload = z.infer<typeof createPatientSchema>;
export type CreateReferralPayload = z.infer<typeof createReferralSchema>;
export type ReferralResponsePayload = z.infer<typeof referralResponseSchema>;
export type VitalsPayload = z.infer<typeof vitalsSchema>;
export type CreateNotePayload = z.infer<typeof createNoteSchema>;
export type PrescribePayload = z.infer<typeof prescribeSchema>;
export type CreateStaffPayload = z.infer<typeof createStaffSchema>;
