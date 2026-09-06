import { describe, it, expect } from 'vitest';
import {
  ROLES, PERMISSIONS, ROLE_PERMISSIONS, ROLE_HOME, ROLE_LABELS,
  permissionsForRole, roleHasPermission, type Role,
} from '@/types/rbac';

describe('role and permission matrix', () => {
  it('defines a label and landing route for every role', () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role], `label for ${role}`).toBeTruthy();
      expect(ROLE_HOME[role], `home route for ${role}`).toMatch(/^\//);
      expect(ROLE_PERMISSIONS[role], `permissions for ${role}`).toBeDefined();
    }
  });

  it('grants the super administrator every permission', () => {
    const all = Object.values(PERMISSIONS);
    const granted = permissionsForRole('SUPER_ADMIN');
    for (const p of all) expect(granted).toContain(p);
  });

  it('never grants a permission that is not in the vocabulary', () => {
    const known = new Set<string>(Object.values(PERMISSIONS));
    for (const role of ROLES) {
      for (const p of permissionsForRole(role)) {
        expect(known.has(p), `${role} has unknown permission ${p}`).toBe(true);
      }
    }
  });

  it('returns each permission once even when composed from several groups', () => {
    for (const role of ROLES) {
      const granted = permissionsForRole(role);
      expect(new Set(granted).size).toBe(granted.length);
    }
  });

  describe('separation of duties', () => {
    const cannot = (role: Role, permission: string) =>
      expect(roleHasPermission(role, permission as never), `${role} must not have ${permission}`).toBe(false);
    const can = (role: Role, permission: string) =>
      expect(roleHasPermission(role, permission as never), `${role} must have ${permission}`).toBe(true);

    it('keeps prescribing away from non-prescribers', () => {
      cannot('NURSE', PERMISSIONS.MEDICATION_PRESCRIBE);
      cannot('PHARMACY', PERMISSIONS.MEDICATION_PRESCRIBE);
      cannot('RADIOLOGY', PERMISSIONS.MEDICATION_PRESCRIBE);
      cannot('PATHOLOGY', PERMISSIONS.MEDICATION_PRESCRIBE);
      cannot('HR_ADMIN', PERMISSIONS.MEDICATION_PRESCRIBE);
      can('SENIOR_DOCTOR', PERMISSIONS.MEDICATION_PRESCRIBE);
      can('JUNIOR_DOCTOR', PERMISSIONS.MEDICATION_PRESCRIBE);
    });

    it('keeps dispensing with pharmacy and administration with nursing', () => {
      can('PHARMACY', PERMISSIONS.MEDICATION_DISPENSE);
      cannot('SENIOR_DOCTOR', PERMISSIONS.MEDICATION_DISPENSE);
      can('NURSE', PERMISSIONS.MEDICATION_ADMINISTER);
      cannot('PHARMACY', PERMISSIONS.MEDICATION_ADMINISTER);
    });

    it('only lets senior doctors answer a referral', () => {
      can('SENIOR_DOCTOR', PERMISSIONS.REFERRAL_RESPOND);
      cannot('JUNIOR_DOCTOR', PERMISSIONS.REFERRAL_RESPOND);
      cannot('NURSE', PERMISSIONS.REFERRAL_RESPOND);
      can('JUNIOR_DOCTOR', PERMISSIONS.REFERRAL_CREATE);
    });

    it('keeps result entry inside the reporting department', () => {
      can('PATHOLOGY', PERMISSIONS.LAB_RESULT);
      cannot('RADIOLOGY', PERMISSIONS.LAB_RESULT);
      can('RADIOLOGY', PERMISSIONS.RADIOLOGY_REPORT);
      cannot('PATHOLOGY', PERMISSIONS.RADIOLOGY_REPORT);
      cannot('SENIOR_DOCTOR', PERMISSIONS.LAB_RESULT);
      cannot('SENIOR_DOCTOR', PERMISSIONS.RADIOLOGY_REPORT);
    });

    it('keeps the HR administrator out of the clinical record', () => {
      cannot('HR_ADMIN', PERMISSIONS.PATIENT_READ);
      cannot('HR_ADMIN', PERMISSIONS.NOTE_READ);
      cannot('HR_ADMIN', PERMISSIONS.TIMELINE_READ);
      cannot('HR_ADMIN', PERMISSIONS.AUDIT_READ);
      can('HR_ADMIN', PERMISSIONS.USER_CREATE);
    });

    it('keeps clinicians out of user administration', () => {
      cannot('SENIOR_DOCTOR', PERMISSIONS.USER_ROLE_CHANGE);
      cannot('SENIOR_DOCTOR', PERMISSIONS.USER_CREATE);
      cannot('NURSE', PERMISSIONS.ADMIN_DASHBOARD);
      can('HOSPITAL_ADMIN', PERMISSIONS.USER_ROLE_CHANGE);
    });

    it('restricts the audit trail to oversight roles', () => {
      can('HOSPITAL_ADMIN', PERMISSIONS.AUDIT_READ);
      can('SUPER_ADMIN', PERMISSIONS.AUDIT_READ);
      cannot('SENIOR_DOCTOR', PERMISSIONS.AUDIT_READ);
      cannot('NURSE', PERMISSIONS.AUDIT_READ);
    });

    it('lets only senior doctors and administrators discharge', () => {
      can('SENIOR_DOCTOR', PERMISSIONS.ADMISSION_DISCHARGE);
      can('HOSPITAL_ADMIN', PERMISSIONS.ADMISSION_DISCHARGE);
      cannot('JUNIOR_DOCTOR', PERMISSIONS.ADMISSION_DISCHARGE);
      cannot('NURSE', PERMISSIONS.ADMISSION_DISCHARGE);
    });
  });
});
