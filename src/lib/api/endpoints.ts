import { api, type Result } from './client';
import type {
  AuthUserDto, DashboardDto, PatientListItemDto, PatientHeaderDto, TimelineItemDto,
  VitalsDto, VitalsTrendPoint, ClinicalNoteDto, ObservationDto, ReferralDto, ReferralDetailDto,
  SpecialistDto, LabOrderDto, RadiologyStudyDto, MedicationOrderDto, NotificationDto,
  WardDto, BedDto, DepartmentDto, StaffDto, AuditEntryDto, ConversationDto,
  ConversationDetailDto, AiSummaryDto, InvestigationOrderDto, CareTeamMemberDto,
  AdmissionDto, AdminDashboardDto, AttachmentDto, StaffDirectoryEntryDto, RoleSummaryDto,
} from '@/types/api';

/* Typed endpoint functions. Components call these, never `fetch` directly. */

export const authApi = {
  login: (body: { email: string; password: string }) =>
    api.post<{ user: AuthUserDto; redirectTo: string }>('/auth/login', body),
  logout: () => api.post<{ loggedOut: boolean }>('/auth/logout'),
  me: () => api.get<AuthUserDto>('/auth/me'),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post<{ changed: boolean; message: string }>('/auth/change-password', body),

  /* --- account lifecycle -------------------------------------------- */
  register: (body: {
    email: string; fullName: string; password: string; confirmPassword: string;
    phone?: string; requestedRole: string; requestedDepartmentId?: string; registrationNote?: string;
  }) => api.post<{ status: string; message: string }>('/auth/register', body),

  verifyEmail: (body: { token: string }) =>
    api.post<{ email: string; status: string; message: string }>('/auth/verify-email', body),

  resendVerification: (body: { email: string }) =>
    api.post<{ message: string }>('/auth/resend-verification', body),

  forgotPassword: (body: { email: string }) =>
    api.post<{ message: string }>('/auth/forgot-password', body),

  resetPassword: (body: { token: string; newPassword: string; confirmPassword: string }) =>
    api.post<{ message: string }>('/auth/reset-password', body),

  describeInvitation: (token: string) =>
    api.get<{ email: string; role: string | null; departmentId: string | null }>(
      `/auth/accept-invitation?token=${encodeURIComponent(token)}`),

  acceptInvitation: (body: {
    token: string; fullName: string; password: string; confirmPassword: string;
    phone?: string; designation?: string;
  }) => api.post<{ id: string; email: string; role: string; message: string }>('/auth/accept-invitation', body),

  refresh: () => api.post<{ expiresAt: string }>('/auth/refresh'),
};

/** Unauthenticated reference data used by the registration form. */
export const referenceApi = {
  publicDepartments: () =>
    api.get<{ id: string; name: string; code: string }[]>('/public/departments'),
  /** Whether anybody has set this deployment up yet. One boolean, nothing else. */
  setupStatus: () => api.get<{ initialised: boolean }>('/public/setup-status'),
};

export type PendingAccountDto = {
  id: string; email: string; fullName: string; phone: string | null;
  requestedRole: string | null; requestedDepartmentId: string | null;
  requestedDepartmentName: string | null; registrationNote: string | null;
  emailVerifiedAt: string | null; status: string; createdAt: string;
};

export const registrationsApi = {
  list: (params?: { limit?: number; cursor?: string }) =>
    api.get<PendingAccountDto[]>('/admin/registrations', params),
  approve: (id: string, body: {
    role: string; departmentId?: string; designation?: string;
    specialization?: string; registrationNumber?: string; acceptsReferrals?: boolean;
  }) => api.post<{ id: string; email: string; role: string }>(`/admin/registrations/${id}/approve`, body),
  reject: (id: string, body: { reason: string }) =>
    api.post<{ id: string }>(`/admin/registrations/${id}/reject`, body),
  invite: (body: { email: string; role: string; departmentId?: string }) =>
    api.post<{ email: string; message: string }>('/admin/invitations', body),
};

export const dashboardApi = {
  get: () => api.get<DashboardDto>('/dashboard'),
  admin: () => api.get<AdminDashboardDto>('/admin/dashboard'),
};

export const patientsApi = {
  search: (params: { q?: string; status?: string; wardId?: string; mineOnly?: boolean; page?: number; pageSize?: number }) =>
    api.get<PatientListItemDto[]>('/patients', params),
  getPatient: (id: string) => api.get<PatientHeaderDto>(`/patients/${id}`),
  create: (body: Record<string, unknown>) => api.post<{ id: string; patientNumber: string }>('/patients', body),
  update: (id: string, body: Record<string, unknown>) => api.patch<PatientHeaderDto>(`/patients/${id}`, body),
  getTimeline: (id: string, params?: { limit?: number; cursor?: string; types?: string }) =>
    api.get<TimelineItemDto[]>(`/patients/${id}/timeline`, params),
  getVitals: (id: string) => api.get<VitalsDto[]>(`/patients/${id}/vitals`),
  getVitalsTrend: (id: string, hours = 72) => api.get<VitalsTrendPoint[]>(`/patients/${id}/vitals/trend`, { hours }),
  getNotes: (id: string, type?: string) => api.get<ClinicalNoteDto[]>(`/patients/${id}/notes`, { type }),
  getObservations: (id: string) => api.get<ObservationDto[]>(`/patients/${id}/observations`),
  getLabs: (id: string) => api.get<LabOrderDto[]>(`/patients/${id}/labs`),
  getRadiology: (id: string) => api.get<RadiologyStudyDto[]>(`/patients/${id}/radiology`),
  getInvestigations: (id: string) => api.get<InvestigationOrderDto[]>(`/patients/${id}/investigations`),
  getMedications: (id: string) => api.get<MedicationOrderDto[]>(`/patients/${id}/medications`),
  getReferrals: (id: string) => api.get<ReferralDto[]>(`/patients/${id}/referrals`),
  getDocuments: (id: string) => api.get<AttachmentDto[]>(`/patients/${id}/documents`),
  getCareTeam: (id: string) => api.get<CareTeamMemberDto[]>(`/patients/${id}/care-team`),
  addCareTeamMember: (id: string, body: { userId: string; role: string }) =>
    api.post<CareTeamMemberDto>(`/patients/${id}/care-team`, body),
  getAiSummaries: (id: string) => api.get<AiSummaryDto[]>(`/patients/${id}/ai-summaries`),
};

export const vitalsApi = {
  create: (patientId: string, body: Record<string, unknown>) =>
    api.post<VitalsDto>(`/patients/${patientId}/vitals`, body),
};

export const notesApi = {
  create: (patientId: string, body: { noteType: string; title: string; content: string }) =>
    api.post<ClinicalNoteDto>(`/patients/${patientId}/notes`, body),
};

export const observationsApi = {
  create: (patientId: string, body: { category: string; content: string; severity?: string }) =>
    api.post<ObservationDto>(`/patients/${patientId}/observations`, body),
};

export const referralsApi = {
  list: (params?: { box?: 'incoming' | 'outgoing' | 'all'; status?: string; patientId?: string; priority?: string }) =>
    api.get<ReferralDto[]>('/referrals', params),
  get: (id: string) => api.get<ReferralDetailDto>(`/referrals/${id}`),
  create: (body: Record<string, unknown>) => api.post<ReferralDto>('/referrals', body),
  accept: (id: string) => api.post<ReferralDto>(`/referrals/${id}/accept`),
  decline: (id: string, reason: string) => api.post<ReferralDto>(`/referrals/${id}/decline`, { reason }),
  requestInformation: (id: string, question: string) =>
    api.post<ReferralDto>(`/referrals/${id}/request-information`, { question }),
  provideInformation: (id: string, answer: string) =>
    api.post<ReferralDto>(`/referrals/${id}/provide-information`, { answer }),
  respond: (id: string, body: { assessment: string; findings: string; recommendations: string; treatmentPlan: string; followUp?: string }) =>
    api.post<{ id: string }>(`/referrals/${id}/respond`, body),
  complete: (id: string) => api.post<ReferralDto>(`/referrals/${id}/complete`),
  cancel: (id: string, reason?: string) => api.post<ReferralDto>(`/referrals/${id}/cancel`, { reason }),
  specialists: () => api.get<SpecialistDto[]>('/specialists'),
};

export const labsApi = {
  listOrders: (params?: { patientId?: string; status?: string; limit?: number }) =>
    api.get<LabOrderDto[]>('/labs/orders', params),
  createOrder: (body: { patientId: string; panel: string; clinicalInfo?: string; priority?: string }) =>
    api.post<LabOrderDto>('/labs/orders', body),
  recordResults: (orderId: string, results: Array<{ analyte: string; value: string; unit?: string; investigationCode?: string }>) =>
    api.post<unknown>(`/labs/orders/${orderId}/results`, { results }),
  catalog: (category?: 'LAB' | 'RADIOLOGY') =>
    api.get<Array<{ id: string; code: string; name: string; panel: string | null; unit: string | null }>>('/labs/catalog', { category }),
};

export const radiologyApi = {
  listStudies: (params?: { patientId?: string; status?: string; limit?: number }) =>
    api.get<RadiologyStudyDto[]>('/radiology/studies', params),
  createStudy: (body: Record<string, unknown>) => api.post<RadiologyStudyDto>('/radiology/studies', body),
  updateStatus: (id: string, status: string) => api.patch<RadiologyStudyDto>(`/radiology/studies/${id}`, { status }),
  report: (id: string, body: { findings: string; impression: string; recommendation?: string; isCritical?: boolean }) =>
    api.post<unknown>(`/radiology/studies/${id}/report`, body),
};

export const pharmacyApi = {
  listOrders: (params?: { patientId?: string; status?: string; limit?: number }) =>
    api.get<MedicationOrderDto[]>('/pharmacy/orders', params),
  prescribe: (body: Record<string, unknown>) => api.post<MedicationOrderDto>('/pharmacy/orders', body),
  updateStatus: (id: string, body: { status: string; stopReason?: string }) =>
    api.patch<MedicationOrderDto>(`/pharmacy/orders/${id}`, body),
  administer: (id: string, body: { doseGiven: string; wasWithheld?: boolean; notes?: string }) =>
    api.post<unknown>(`/pharmacy/orders/${id}/administer`, body),
  formulary: (q?: string) =>
    api.get<Array<{ id: string; name: string; strength: string | null; form: string }>>('/pharmacy/formulary', { q }),
};

export const notificationsApi = {
  list: (params?: { unreadOnly?: boolean; limit?: number }) =>
    api.get<NotificationDto[]>('/notifications', params) as Promise<Result<NotificationDto[]>>,
  markRead: (id: string) => api.patch<{ unreadCount: number }>(`/notifications/${id}/read`),
  markAllRead: () => api.patch<{ marked: number; unreadCount: number }>('/notifications/read-all'),
};

export const admissionsApi = {
  list: (params?: { status?: string; limit?: number }) => api.get<AdmissionDto[]>('/admissions', params),
  create: (body: Record<string, unknown>) => api.post<AdmissionDto>('/admissions', body),
  transfer: (id: string, body: { toWardId: string; toBedId?: string; reason?: string }) =>
    api.post<AdmissionDto>(`/admissions/${id}/transfer`, body),
  discharge: (id: string, summary: string) => api.post<AdmissionDto>(`/admissions/${id}/discharge`, { summary }),
};

export const wardsApi = {
  list: (departmentId?: string) => api.get<WardDto[]>('/wards', { departmentId }),
  create: (body: Record<string, unknown>) => api.post<WardDto>('/wards', body),
  beds: (wardId?: string) => api.get<BedDto[]>('/beds', { wardId }),
  createBed: (body: { wardId: string; code: string }) => api.post<BedDto>('/beds', body),
  setBedStatus: (id: string, status: string) => api.patch<BedDto>(`/beds/${id}`, { status }),
};

export const departmentsApi = {
  list: () => api.get<DepartmentDto[]>('/departments'),
};

export const adminApi = {
  listStaff: (params?: { role?: string; departmentId?: string; isActive?: boolean; q?: string }) =>
    api.get<StaffDto[]>('/admin/staff', params),
  createStaff: (body: Record<string, unknown>) => api.post<StaffDto>('/admin/staff', body),
  updateStaff: (id: string, body: Record<string, unknown>) => api.patch<StaffDto>(`/admin/staff/${id}`, body),
  changeRole: (id: string, role: string) => api.post<{ role: string }>(`/admin/staff/${id}/role`, { role }),
  setActive: (id: string, isActive: boolean) => api.post<{ isActive: boolean }>(`/admin/staff/${id}/status`, { isActive }),
  resetPassword: (id: string, newPassword: string) => api.post<{ id: string }>(`/admin/staff/${id}/reset-password`, { newPassword }),
  listDepartments: () => api.get<DepartmentDto[]>('/admin/departments'),
  createDepartment: (body: Record<string, unknown>) => api.post<DepartmentDto>('/admin/departments', body),
  roles: () => api.get<RoleSummaryDto[]>('/admin/roles'),
  audit: (params?: { patientId?: string; userId?: string; action?: string; limit?: number; cursor?: string }) =>
    api.get<AuditEntryDto[]>('/admin/audit', params),
};

export const messagesApi = {
  list: () => api.get<ConversationDto[]>('/messages'),
  get: (id: string) => api.get<ConversationDetailDto>(`/messages/${id}`),
  create: (body: { subject: string; participantIds: string[]; patientId?: string; firstMessage?: string }) =>
    api.post<{ id: string }>('/messages', body),
  send: (id: string, body: string) => api.post<unknown>(`/messages/${id}/messages`, { body }),
};

export const staffApi = {
  directory: () => api.get<StaffDirectoryEntryDto[]>('/staff'),
};

export const aiApi = {
  patientSummary: (body: { patientId: string; kind?: string; days?: number }) =>
    api.post<AiSummaryDto & { banner: string }>('/ai/patient-summary', body),
  handover: () => api.get<{ content: string; keyPoints: string[]; banner: string; patientCount: number }>('/ai/handover'),
  review: (id: string) => api.post<unknown>(`/ai/summaries/${id}/review`),
};

export const searchApi = {
  global: (q: string) => api.get<{ patients: Array<{ id: string; patientNumber: string; firstName: string; lastName: string; status: string }> }>('/search', { q }),
};

export const filesApi = {
  upload: (form: FormData) => api.request<AttachmentDto>('/files', { method: 'POST', body: form }),
  downloadUrl: (id: string) => `/api/files/${id}`,
};
