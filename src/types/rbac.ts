/** Shared role & permission vocabulary (safe to import from client code). */

export const ROLES = [
  'SUPER_ADMIN', 'HOSPITAL_ADMIN', 'SENIOR_DOCTOR', 'JUNIOR_DOCTOR',
  'NURSE', 'RADIOLOGY', 'PATHOLOGY', 'PHARMACY', 'HR_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  PATIENT_READ: 'patient:read',
  PATIENT_SEARCH: 'patient:search',
  PATIENT_CREATE: 'patient:create',
  PATIENT_UPDATE: 'patient:update',
  ADMISSION_READ: 'admission:read',
  ADMISSION_CREATE: 'admission:create',
  ADMISSION_TRANSFER: 'admission:transfer',
  ADMISSION_DISCHARGE: 'admission:discharge',
  WARD_READ: 'ward:read',
  WARD_MANAGE: 'ward:manage',
  ENCOUNTER_READ: 'encounter:read',
  ENCOUNTER_CREATE: 'encounter:create',
  NOTE_READ: 'note:read',
  NOTE_CREATE: 'note:create',
  NOTE_UPDATE: 'note:update',
  VITALS_READ: 'vitals:read',
  VITALS_CREATE: 'vitals:create',
  OBSERVATION_READ: 'observation:read',
  OBSERVATION_CREATE: 'observation:create',
  LAB_ORDER: 'lab:order',
  LAB_READ: 'lab:read',
  LAB_RESULT: 'lab:result',
  RADIOLOGY_ORDER: 'radiology:order',
  RADIOLOGY_READ: 'radiology:read',
  RADIOLOGY_REPORT: 'radiology:report',
  MEDICATION_READ: 'medication:read',
  MEDICATION_PRESCRIBE: 'medication:prescribe',
  MEDICATION_UPDATE: 'medication:update',
  MEDICATION_DISPENSE: 'medication:dispense',
  MEDICATION_ADMINISTER: 'medication:administer',
  REFERRAL_READ: 'referral:read',
  REFERRAL_CREATE: 'referral:create',
  REFERRAL_RESPOND: 'referral:respond',
  REFERRAL_MANAGE: 'referral:manage',
  NOTIFICATION_READ: 'notification:read',
  MESSAGE_READ: 'message:read',
  MESSAGE_SEND: 'message:send',
  TIMELINE_READ: 'timeline:read',
  FILE_READ: 'file:read',
  FILE_UPLOAD: 'file:upload',
  CARETEAM_MANAGE: 'careteam:manage',
  AI_USE: 'ai:use',
  ADMIN_DASHBOARD: 'admin:dashboard',
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_ROLE_CHANGE: 'user:role_change',
  DEPARTMENT_MANAGE: 'department:manage',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

const CLINICAL_READ: Permission[] = [
  P.PATIENT_READ, P.PATIENT_SEARCH, P.ADMISSION_READ, P.WARD_READ, P.ENCOUNTER_READ,
  P.NOTE_READ, P.VITALS_READ, P.OBSERVATION_READ, P.LAB_READ, P.RADIOLOGY_READ,
  P.MEDICATION_READ, P.REFERRAL_READ, P.TIMELINE_READ, P.FILE_READ,
  P.NOTIFICATION_READ, P.MESSAGE_READ, P.MESSAGE_SEND, P.AI_USE,
];

const DOCTOR_CORE: Permission[] = [
  ...CLINICAL_READ,
  P.PATIENT_CREATE, P.PATIENT_UPDATE, P.ADMISSION_CREATE, P.ENCOUNTER_CREATE,
  P.NOTE_CREATE, P.NOTE_UPDATE, P.VITALS_CREATE, P.LAB_ORDER, P.RADIOLOGY_ORDER,
  P.MEDICATION_PRESCRIBE, P.MEDICATION_UPDATE, P.REFERRAL_CREATE, P.FILE_UPLOAD,
];

/** Single source of truth. Mirrored into the `permissions` table by the seed. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: Object.values(P),

  HOSPITAL_ADMIN: [
    ...CLINICAL_READ,
    P.ADMISSION_CREATE, P.ADMISSION_TRANSFER, P.ADMISSION_DISCHARGE,
    P.WARD_MANAGE, P.CARETEAM_MANAGE, P.REFERRAL_MANAGE,
    P.ADMIN_DASHBOARD, P.USER_READ, P.USER_CREATE, P.USER_UPDATE,
    P.USER_ROLE_CHANGE, P.DEPARTMENT_MANAGE, P.AUDIT_READ,
  ],

  SENIOR_DOCTOR: [
    ...DOCTOR_CORE,
    P.ADMISSION_TRANSFER, P.ADMISSION_DISCHARGE, P.REFERRAL_RESPOND,
    P.REFERRAL_MANAGE, P.CARETEAM_MANAGE,
  ],

  JUNIOR_DOCTOR: [...DOCTOR_CORE],

  NURSE: [
    ...CLINICAL_READ,
    P.VITALS_CREATE, P.OBSERVATION_CREATE, P.NOTE_CREATE,
    P.MEDICATION_ADMINISTER, P.ENCOUNTER_CREATE,
  ],

  RADIOLOGY: [
    P.PATIENT_READ, P.PATIENT_SEARCH, P.ADMISSION_READ, P.TIMELINE_READ,
    P.RADIOLOGY_READ, P.RADIOLOGY_REPORT, P.FILE_READ, P.FILE_UPLOAD,
    P.NOTIFICATION_READ, P.MESSAGE_READ, P.MESSAGE_SEND, P.AI_USE, P.NOTE_READ,
  ],

  PATHOLOGY: [
    P.PATIENT_READ, P.PATIENT_SEARCH, P.ADMISSION_READ, P.TIMELINE_READ,
    P.LAB_READ, P.LAB_RESULT, P.FILE_READ, P.FILE_UPLOAD,
    P.NOTIFICATION_READ, P.MESSAGE_READ, P.MESSAGE_SEND, P.AI_USE, P.NOTE_READ,
  ],

  PHARMACY: [
    P.PATIENT_READ, P.PATIENT_SEARCH, P.ADMISSION_READ, P.TIMELINE_READ,
    P.MEDICATION_READ, P.MEDICATION_DISPENSE, P.MEDICATION_UPDATE,
    P.NOTIFICATION_READ, P.MESSAGE_READ, P.MESSAGE_SEND, P.AI_USE, P.NOTE_READ,
  ],

  HR_ADMIN: [
    P.ADMIN_DASHBOARD, P.USER_READ, P.USER_CREATE, P.USER_UPDATE,
    P.USER_ROLE_CHANGE, P.DEPARTMENT_MANAGE, P.NOTIFICATION_READ,
    P.MESSAGE_READ, P.MESSAGE_SEND,
  ],
};

export function permissionsForRole(role: Role): Permission[] {
  return [...new Set(ROLE_PERMISSIONS[role] ?? [])];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'System Administrator',
  HOSPITAL_ADMIN: 'Hospital Administrator',
  SENIOR_DOCTOR: 'Senior Doctor / Consultant',
  JUNIOR_DOCTOR: 'Junior Doctor',
  NURSE: 'Nurse',
  RADIOLOGY: 'Radiology',
  PATHOLOGY: 'Pathology / Laboratory',
  PHARMACY: 'Pharmacy',
  HR_ADMIN: 'HR / Staff Administration',
};

/** Landing route after login, per §6 of the product prompt. */
export const ROLE_HOME: Record<Role, string> = {
  SUPER_ADMIN: '/admin',
  HOSPITAL_ADMIN: '/admin',
  SENIOR_DOCTOR: '/dashboard',
  JUNIOR_DOCTOR: '/dashboard',
  NURSE: '/nursing',
  RADIOLOGY: '/radiology',
  PATHOLOGY: '/pathology',
  PHARMACY: '/pharmacy',
  HR_ADMIN: '/admin/staff',
};

export const DOCTOR_ROLES: Role[] = ['SENIOR_DOCTOR', 'JUNIOR_DOCTOR'];
export const OVERSIGHT_ROLES: Role[] = ['SUPER_ADMIN', 'HOSPITAL_ADMIN'];
