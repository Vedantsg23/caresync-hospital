'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui';

const ROLE_LABELS: Record<string, string> = {
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

function passwordChecks(value: string) {
  return [
    { ok: value.length >= 10, label: 'At least 10 characters' },
    { ok: /[a-z]/.test(value), label: 'A lowercase letter' },
    { ok: /[A-Z]/.test(value), label: 'An uppercase letter' },
    { ok: /[0-9]/.test(value), label: 'A number' },
  ];
}

export function AcceptInvitationForm({ token }: { token: string }) {
  const router = useRouter();
  const [invitation, setInvitation] = React.useState<{ email: string; role: string | null } | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ fullName: '', password: '', confirm: '', phone: '', designation: '' });
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  React.useEffect(() => {
    if (!token) { setLoadError('This page needs an invitation link.'); return; }
    authApi.describeInvitation(token)
      .then(({ data }) => setInvitation({ email: data.email, role: data.role }))
      .catch((err) => setLoadError(err instanceof ApiError
        ? err.message
        : 'This invitation is invalid or has expired.'));
  }, [token]);

  const checks = passwordChecks(form.password);
  const ready = checks.every((c) => c.ok);
  const matches = form.password.length > 0 && form.password === form.confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      await authApi.acceptInvitation({
        token,
        fullName: form.fullName,
        password: form.password,
        confirmPassword: form.confirm,
        phone: form.phone || undefined,
        designation: form.designation || undefined,
      });
      router.push('/login?invited=1');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      } else {
        setError('Could not activate your account. Ask for a fresh invitation.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-space-5">
        <div role="alert" className="flex items-start gap-space-3 rounded-xl border border-error/30 bg-error-container/40 p-space-4">
          <ShieldAlert className="h-5 w-5 text-error shrink-0 mt-0.5" aria-hidden />
          <p className="text-body-sm text-on-error-container">{loadError}</p>
        </div>
        <Link href="/login" className="text-body-sm text-primary font-medium hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="flex items-center gap-space-3 text-on-surface-variant">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-body-md">Checking your invitation…</span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-space-5" noValidate>
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-space-4 space-y-1">
        <p className="text-label-md text-on-surface-variant uppercase tracking-wide">Invitation for</p>
        <p className="text-body-md text-on-surface font-medium">{invitation.email}</p>
        {invitation.role ? (
          <p className="text-body-sm text-on-surface-variant">
            Role: {ROLE_LABELS[invitation.role] ?? invitation.role}
          </p>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="flex items-start gap-space-3 rounded-xl border border-error/30 bg-error-container/40 p-space-4">
          <ShieldAlert className="h-5 w-5 text-error shrink-0 mt-0.5" aria-hidden />
          <p className="text-body-sm text-on-error-container">{error}</p>
        </div>
      ) : null}

      <Field label="Full name" htmlFor="fullName" required error={fieldErrors.fullName}>
        <Input id="fullName" required autoComplete="name" value={form.fullName} onChange={set('fullName')} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-space-4">
        <Field label="Designation" htmlFor="designation" hint="How you appear on the chart.">
          <Input id="designation" value={form.designation} onChange={set('designation')} placeholder="Consultant Cardiologist" />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
        </Field>
      </div>

      <Field label="Password" htmlFor="password" required error={fieldErrors.password}>
        <Input id="password" type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} />
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
        label="Confirm password" htmlFor="confirm" required
        error={fieldErrors.confirmPassword ?? (form.confirm && !matches ? 'Passwords do not match' : undefined)}
      >
        <Input id="confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
      </Field>

      <Button
        type="submit" className="w-full" loading={loading} disabled={!ready || !matches}
        icon={<UserCheck className="h-4 w-4" aria-hidden />}
      >
        Activate my account
      </Button>
    </form>
  );
}
