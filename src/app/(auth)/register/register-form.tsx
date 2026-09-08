'use client';

import * as React from 'react';
import Link from 'next/link';
import { UserPlus, MailCheck, ShieldAlert } from 'lucide-react';
import { authApi, referenceApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';

/**
 * Staff registration.
 *
 * The role selector deliberately does not offer administrator roles, and the
 * server would refuse them regardless — the list here is a convenience, not the
 * control. What the form makes clear, because people are confused by it
 * otherwise, is that choosing a role is a *request*: an administrator decides
 * what is actually granted.
 */

const REQUESTABLE_ROLES = [
  { value: 'SENIOR_DOCTOR', label: 'Senior Doctor / Consultant' },
  { value: 'JUNIOR_DOCTOR', label: 'Junior Doctor' },
  { value: 'NURSE', label: 'Nurse' },
  { value: 'RADIOLOGY', label: 'Radiology' },
  { value: 'PATHOLOGY', label: 'Pathology / Laboratory' },
  { value: 'PHARMACY', label: 'Pharmacy' },
  { value: 'HR_ADMIN', label: 'HR / Staff Administration' },
];

/** Mirrors the server policy in src/server/auth/password.ts. */
function passwordChecks(value: string) {
  return [
    { ok: value.length >= 10, label: 'At least 10 characters' },
    { ok: /[a-z]/.test(value), label: 'A lowercase letter' },
    { ok: /[A-Z]/.test(value), label: 'An uppercase letter' },
    { ok: /[0-9]/.test(value), label: 'A number' },
  ];
}

type Department = { id: string; name: string };

export function RegisterForm() {
  const [form, setForm] = React.useState({
    fullName: '', email: '', phone: '', password: '', confirmPassword: '',
    requestedRole: '', requestedDepartmentId: '', registrationNote: '',
  });
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [submitted, setSubmitted] = React.useState<string | null>(null);

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  React.useEffect(() => {
    // Public reference data only — names of departments, nothing patient-related.
    referenceApi.publicDepartments()
      .then(({ data }) => setDepartments(data))
      .catch(() => setDepartments([]));
  }, []);

  const checks = passwordChecks(form.password);
  const passwordReady = checks.every((c) => c.ok);
  const matches = form.password.length > 0 && form.password === form.confirmPassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const { data } = await authApi.register({
        email: form.email,
        fullName: form.fullName,
        password: form.password,
        confirmPassword: form.confirmPassword,
        phone: form.phone || undefined,
        requestedRole: form.requestedRole,
        requestedDepartmentId: form.requestedDepartmentId || undefined,
        registrationNote: form.registrationNote || undefined,
      });
      setSubmitted(data.message);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      } else {
        setError('Could not submit your registration. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-space-6">
        <div className="flex items-start gap-space-3 rounded-xl border border-outline-variant bg-surface-container-low p-space-4">
          <MailCheck className="h-5 w-5 text-tertiary shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <p className="text-body-md text-on-surface font-medium">Check your email</p>
            <p className="text-body-sm text-on-surface-variant">{submitted}</p>
          </div>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Sent to <span className="font-medium text-on-surface">{form.email}</span>. The link expires
          in 24 hours. You will not be able to sign in until the address is confirmed and an
          administrator has approved the account.
        </p>
        <Link href="/login" className="text-body-sm text-primary font-medium hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-space-5" noValidate>
      {error ? (
        <div role="alert" className="flex items-start gap-space-3 rounded-xl border border-error/30 bg-error-container/40 p-space-4">
          <ShieldAlert className="h-5 w-5 text-error shrink-0 mt-0.5" aria-hidden />
          <p className="text-body-sm text-on-error-container">{error}</p>
        </div>
      ) : null}

      <Field label="Full name" htmlFor="fullName" required error={fieldErrors.fullName}>
        <Input
          id="fullName" name="fullName" autoComplete="name" required
          value={form.fullName} onChange={set('fullName')}
          invalid={Boolean(fieldErrors.fullName)} placeholder="Dr. Anjali Verma"
        />
      </Field>

      <Field label="Work email address" htmlFor="email" required error={fieldErrors.email}>
        <Input
          id="email" name="email" type="email" autoComplete="email" required
          value={form.email} onChange={set('email')}
          invalid={Boolean(fieldErrors.email)} placeholder="you@hospital.org"
        />
      </Field>

      <Field label="Phone number" htmlFor="phone" hint="Optional — used for urgent clinical contact." error={fieldErrors.phone}>
        <Input
          id="phone" name="phone" type="tel" autoComplete="tel"
          value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210"
        />
      </Field>

      <div className="grid sm:grid-cols-2 gap-space-4">
        <Field label="Role you are applying for" htmlFor="requestedRole" required error={fieldErrors.requestedRole}>
          <Select
            id="requestedRole" name="requestedRole" required
            value={form.requestedRole} onChange={set('requestedRole')}
            invalid={Boolean(fieldErrors.requestedRole)}
          >
            <option value="">Select a role</option>
            {REQUESTABLE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>

        <Field label="Department" htmlFor="requestedDepartmentId" error={fieldErrors.requestedDepartmentId}>
          <Select
            id="requestedDepartmentId" name="requestedDepartmentId"
            value={form.requestedDepartmentId} onChange={set('requestedDepartmentId')}
          >
            <option value="">Not sure / not applicable</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
      </div>

      <p className="text-body-sm text-on-surface-variant -mt-space-2">
        This is a <span className="font-medium text-on-surface">request</span>. A hospital
        administrator reviews it and decides what access you are granted. Administrator accounts
        cannot be self-registered.
      </p>

      <Field
        label="Professional details"
        htmlFor="registrationNote"
        hint="Registration number, specialty, who to verify you with — whatever helps the approver."
        error={fieldErrors.registrationNote}
      >
        <Textarea
          id="registrationNote" name="registrationNote" rows={3}
          value={form.registrationNote} onChange={set('registrationNote')}
          placeholder="MCI 2018/44231. Cardiology registrar, verified by Dr. Priya Mehta."
        />
      </Field>

      <Field label="Password" htmlFor="password" required error={fieldErrors.password}>
        <Input
          id="password" name="password" type="password" autoComplete="new-password" required
          value={form.password} onChange={set('password')}
          invalid={Boolean(fieldErrors.password)}
        />
      </Field>

      {form.password.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-space-4 gap-y-1 -mt-space-3">
          {checks.map((c) => (
            <li key={c.label} className={`text-label-md ${c.ok ? 'text-tertiary' : 'text-on-surface-variant'}`}>
              <span aria-hidden>{c.ok ? '✓' : '·'}</span> {c.label}
            </li>
          ))}
        </ul>
      ) : null}

      <Field
        label="Confirm password" htmlFor="confirmPassword" required
        error={fieldErrors.confirmPassword
          ?? (form.confirmPassword && !matches ? 'Passwords do not match' : undefined)}
      >
        <Input
          id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required
          value={form.confirmPassword} onChange={set('confirmPassword')}
          invalid={Boolean(form.confirmPassword) && !matches}
        />
      </Field>

      <Button
        type="submit" className="w-full" loading={loading}
        disabled={!passwordReady || !matches || !form.requestedRole}
        icon={<UserPlus className="h-4 w-4" aria-hidden />}
      >
        Create account
      </Button>

      <p className="text-body-sm text-on-surface-variant text-center">
        Already have an account?{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
