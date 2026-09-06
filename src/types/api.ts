import type { Permission, Role } from './rbac';

/** Response models shared by the API client, hooks and components. */

export type AuthUserDto = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  permissions: Permission[];
  departmentId: string | null;
  departmentName: string | null;
  departmentCode?: string | null;
  designation: string | null;
  specialization: string | null;
  staffNumber: string | null;
  acceptsReferrals?: boolean;
  homeRoute?: string;
};

export type PatientStatus = 'STABLE' | 'NEEDS_ATTENTION' | 'CRITICAL';
export type ReferralStatus =
  | 'PENDING' | 'ACCEPTED' | 'IN_PROGRESS' | 'REQUESTED_INFORMATION'
  | 'COMPLETED' | 'DECLINED' | 'CANCELLED';
export type ReferralPriority = 'ROUTINE' | 'URGENT' | 'EMERGENCY';
export type Severity = 'INFO' | 'ATTENTION' | 'CRITICAL';

export type PatientListItemDto = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number;
  gender: string;
  bloodGroup: string;
  status: PatientStatus;
  allergies: string[];
  admission: {
    id: string;
    admissionNumber: string;
    admissionDate: string;
    status: string;
    wardName: string | null;
    bedCode: string | null;
    departmentName: string | null;
    attendingDoctorName: string | null;
  } | null;
};

export type CareTeamMemberDto = {
  id: string;
  role: string;
  userId: string;
  name: string;
  userRole: Role;
  designation?: string | null;
  departmentName?: string | null;
  assignedAt?: string;
};

export type VitalsDto = {
  id: string;
  temperatureC: number | null;
  heartRate: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
  painScore: number | null;
  bloodGlucose: number | null;
  newsScore: number | null;
  isAbnormal: boolean;
  notes: string | null;
  recordedAt: string;
  recordedByName?: string;
  recordedByRole?: Role;
  assessment?: { score: number; abnormal: boolean; reasons: string[] };
};

export type VitalsTrendPoint = {
  recordedAt: string;
  heartRate: number | null;
  systolic: number | null;
  diastolic: number | null;
  spo2: number | null;
  temperatureC: number | null;
  newsScore: number | null;
};

export type PatientHeaderDto = {
  id: string;
  patientNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  allergies: string[];
  chronicConditions: string[];
  status: PatientStatus;
  admission: {
    id: string;
    admissionNumber: string;
    admissionDate: string;
    dischargeDate: string | null;
    status: string;
    reason: string;
    wardId: string | null;
    wardName: string | null;
    bedId: string | null;
    bedCode: string | null;
    departmentId: string | null;
    departmentName: string | null;
    attendingDoctorId: string | null;
    attendingDoctorName: string | null;
  } | null;
  careTeam: CareTeamMemberDto[];
  latestVitals: VitalsDto | null;
  activeMedications: Array<{ id: string; medicineName: string; dose: string; frequency: string; route: string; status: string }>;
  contacts: Array<{ id: string; name: string; relationship: string; phone: string; isPrimary: boolean }>;
};

export type TimelineItemDto = {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  severity: Severity;
  occurredAt: string;
  referenceType: string | null;
  referenceId: string | null;
  metadata: unknown;
  actor: { id: string; name: string; role: Role } | null;
  department: { id: string; name: string } | null;
};

export type ClinicalNoteDto = {
  id: string;
  noteType: string;
  title: string;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  departmentName: string | null;
};

export type ObservationDto = {
  id: string;
  category: string;
  content: string;
  severity: Severity;
  recordedAt: string;
  recordedByName: string;
  recordedByRole: Role;
};

export type ReferralDto = {
  id: string;
  referralNumber: string;
  patientId: string;
  reason: string;
  clinicalSummary: string;
  symptoms: string | null;
  relevantHistory: string | null;
  relevantInvestigations: string | null;
  currentMedications: string | null;
  priority: ReferralPriority;
  status: ReferralStatus;
  informationRequest: string | null;
  informationResponse: string | null;
  declineReason: string | null;
  createdAt: string;
  acceptedAt: string | null;
  respondedAt: string | null;
  completedAt: string | null;
  patientNumber: string;
  patientFirstName: string;
  patientLastName: string;
  patientDob: string;
  patientGender: string;
  patientStatus: PatientStatus;
  patientAllergies: string[];
  referringDoctorId: string;
  referringDoctorName: string;
  specialistDoctorId: string;
  specialistDoctorName: string;
  specialistSpecialization: string | null;
  fromDepartmentId: string;
  fromDepartmentName: string;
  toDepartmentId: string;
  toDepartmentName: string;
};

export type ReferralResponseDto = {
  id: string;
  assessment: string;
  findings: string;
  recommendations: string;
  treatmentPlan: string;
  followUp: string | null;
  isFinal: boolean;
  createdAt: string;
  authorId: string;
  authorName: string;
};

export type ReferralDetailDto = ReferralDto & { responses: ReferralResponseDto[] };

export type SpecialistDto = {
  id: string;
  fullName: string;
  role: Role;
  designation: string | null;
  specialization: string | null;
  departmentId: string | null;
  departmentName: string | null;
  acceptsReferrals: boolean;
};

export type LabResultDto = {
  id: string;
  analyte: string;
  value: string;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  flag: 'NORMAL' | 'LOW' | 'HIGH' | 'CRITICAL_LOW' | 'CRITICAL_HIGH' | 'ABNORMAL';
  comment: string | null;
  resultedAt: string;
  resultedByName: string;
};

export type LabOrderDto = {
  id: string;
  orderNumber: string;
  panel: string;
  clinicalInfo: string | null;
  priority: string;
  status: string;
  orderedAt: string;
  completedAt: string | null;
  patientId: string;
  patientName: string;
  patientNumber: string;
  orderedByName: string;
  resultCount: number;
  abnormalCount: number;
  results?: LabResultDto[];
};

export type RadiologyReportDto = {
  id: string;
  findings: string;
  impression: string;
  recommendation: string | null;
  isCritical: boolean;
  reportedAt: string;
  radiologistName: string;
};

export type RadiologyStudyDto = {
  id: string;
  accessionNumber: string;
  modality: string;
  bodyPart: string;
  description: string;
  clinicalInfo: string | null;
  contrastUsed: boolean;
  priority: string;
  status: string;
  requestedAt: string;
  performedAt: string | null;
  patientId: string;
  patientName: string;
  patientNumber: string;
  requestedByName: string;
  departmentName: string | null;
  reports: RadiologyReportDto[];
};

export type MedicationAdministrationDto = {
  id: string;
  doseGiven: string;
  wasWithheld: boolean;
  notes: string | null;
  administeredAt: string;
  administeredByName: string;
};

export type MedicationOrderDto = {
  id: string;
  medicineName: string;
  dose: string;
  frequency: string;
  route: string;
  instructions: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  stopReason: string | null;
  dispensedAt: string | null;
  createdAt: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  patientAllergies: string[];
  prescriberName: string;
  wardName: string | null;
  bedCode: string | null;
  administrationCount: number;
  administrations?: MedicationAdministrationDto[];
};

export type InvestigationOrderDto = {
  id: string;
  orderNumber: string;
  category: 'LAB' | 'RADIOLOGY';
  panel: string;
  clinicalInfo: string | null;
  priority: string;
  status: string;
  orderedAt: string;
  completedAt: string | null;
  orderedByName: string;
  abnormalCount: number;
  resultCount: number;
};

export type NotificationDto = {
  id: string;
  type: string;
  title: string;
  message: string;
  referenceType: string | null;
  referenceId: string | null;
  link: string | null;
  severity: Severity;
  read: boolean;
  createdAt: string;
  patientId: string | null;
};

export type WardDto = {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  isCritical: boolean;
  departmentId: string;
  departmentName: string;
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
};

export type BedDto = {
  id: string;
  code: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'CLEANING' | 'RESERVED';
  notes: string | null;
  wardId: string;
  wardName: string;
  departmentName: string;
  patientId: string | null;
  patientName: string | null;
  patientNumber: string | null;
  admissionId: string | null;
};

export type DepartmentDto = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isClinical: boolean;
  isActive: boolean;
  staffCount?: number;
};

export type StaffDto = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  staffNumber: string | null;
  designation: string | null;
  specialization: string | null;
  registrationNumber: string | null;
  phone: string | null;
  acceptsReferrals: boolean | null;
  departmentId: string | null;
  departmentName: string | null;
  activeSessions: number;
};

export type StaffDirectoryEntryDto = {
  id: string;
  fullName: string;
  role: Role;
  designation: string | null;
  specialization: string | null;
  departmentName: string | null;
};

export type RoleSummaryDto = {
  id: string;
  name: Role;
  label: string;
  description: string | null;
  userCount: number;
  permissions: Permission[];
};

export type AuditEntryDto = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
  actorEmail: string | null;
  actorRole: Role | null;
  actorName: string | null;
  patientId: string | null;
  patientName: string | null;
  patientNumber: string | null;
};

export type ConversationDto = {
  id: string;
  subject: string;
  lastMessageAt: string;
  createdAt: string;
  patientId: string | null;
  patientName: string | null;
  patientNumber: string | null;
  participantCount: number;
  messageCount: number;
  unreadCount: number;
  lastMessage: string | null;
};

export type ConversationDetailDto = {
  id: string;
  subject: string;
  createdAt: string;
  patientId: string | null;
  patientName: string | null;
  patientNumber: string | null;
  participants: Array<{ userId: string; name: string; role: Role; designation: string | null; departmentName: string | null }>;
  messages: Array<{ id: string; body: string; createdAt: string; senderId: string; senderName: string; senderRole: Role }>;
};

export type AiSummaryDto = {
  id: string;
  kind: string;
  content: string;
  keyPoints: string[];
  provider: string;
  model: string | null;
  reviewed?: boolean;
  createdAt: string;
  requestedByName?: string;
  banner?: string;
};

export type AttachmentDto = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  createdAt: string;
  uploadedByName: string;
};

export type AdmissionDto = {
  id: string;
  admissionNumber: string;
  admissionDate: string;
  dischargeDate: string | null;
  status: string;
  reason: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  patientStatus: PatientStatus;
  wardName: string | null;
  bedCode: string | null;
  departmentName: string;
  attendingDoctorName: string;
};

export type DoctorDashboardDto = {
  role: Role;
  kpis: {
    patientsUnderCare: number; criticalAttention: number; needsAttention: number;
    admittedToday: number; pendingReferrals: number; activeReferrals: number;
    awaitingSpecialist: number; completedReferrals: number; newResults: number;
    abnormalResults: number; consultationsToday: number;
  };
  patientsRequiringAttention: Array<{
    id: string; patientNumber: string; firstName: string; lastName: string;
    dateOfBirth: string; gender: string; status: PatientStatus; allergies: string[];
    admissionId: string | null; admissionReason: string | null;
    wardName: string | null; bedCode: string | null; departmentName: string | null;
    lastVitalsAt: string | null; heartRate: number | null; systolic: number | null;
    diastolic: number | null; spo2: number | null; newsScore: number | null;
  }>;
  recentActivity: Array<{
    id: string; eventType: string; title: string; description: string | null;
    severity: Severity; occurredAt: string; patientId: string; patientName: string;
    actorName: string | null; departmentName: string | null;
  }>;
  todaysConsultations: Array<{
    id: string; encounterType: string; reason: string | null; startTime: string;
    status: string; patientId: string; patientName: string; patientNumber: string;
  }>;
  wardCapacity: Array<{ id: string; name: string; isCritical: boolean; total: number; occupied: number }>;
};

export type NurseDashboardDto = {
  role: Role;
  kpis: { assignedPatients: number; critical: number; needsAttention: number; vitalsDue: number; medicationsDue: number };
  assignedPatients: Array<{
    id: string; patientNumber: string; firstName: string; lastName: string;
    dateOfBirth: string; gender: string; status: PatientStatus; allergies: string[];
    admissionId: string; admissionReason: string; wardId: string | null; wardName: string | null;
    bedCode: string | null; lastVitalsAt: string | null; lastNewsScore: number | null; dueMedications: number;
  }>;
  vitalsDue: NurseDashboardDto['assignedPatients'];
  wardSummary: Array<{ id: string; name: string; total: number; occupied: number; available: number }>;
};

export type DepartmentDashboardDto = { role: Role; kpis: Record<string, number> };

export type AdminDashboardDto = {
  role?: Role;
  kpis: Record<string, number>;
  departmentActivity: Array<{
    id: string; name: string; code: string; staff: number;
    activeAdmissions: number; referralsIn: number; referralsOut: number; events7d: number;
  }>;
  activityByDay: Array<{ day: string; count: number }>;
  recentAudit: Array<{
    id: string; action: string; entityType: string; outcome: string;
    createdAt: string; actorEmail: string | null; actorRole: Role | null;
  }>;
};

export type DashboardDto = DoctorDashboardDto | NurseDashboardDto | DepartmentDashboardDto | AdminDashboardDto;
