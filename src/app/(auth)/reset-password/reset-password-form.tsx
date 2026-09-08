'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui';

function passwordChecks(value: string) {
  return [
    { ok: value.length >= 10, label: 'At least 10 characters' },
    { ok: /[a-z]/.test(value), label: 'A lowercase letter' },
    { ok: /[A-Z]/.test(value), label: 'An uppercase letter' },
    { ok: /[0-9]/.test(value), label: 'A number' },
  ];
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const checks = passwordChecks(password);
  const ready = checks.every((c) => c.ok);
  const matches = password.length > 0 && password === confirm;

  if (!token) {
    return (
      <div className="space-y-space-5">
        <div role="alert" className="flex items-start gap-space-3 rounded-xl border border-error/30 bg-error-container/40 p-space-4">
          <ShieldAlert className="h-5 w-5 text-error shrink-0 mt-0.5" aria-hidden />
          <p className="text-body-sm text-on-error-container">
            This page needs a reset link. Request one from the sign-in page.
          </p>
        </div>
        <Link href="/forgot-password" className="text-body-sm text-primary font-medium hover:underline">
          Request a reset link
        </Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      await authApi.resetPassword({ token, newPassword: password, confirmPassword: confirm });
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      } else {
        setError('Could not reset your password. Request a new link and try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-space-5">
        <div className="flex items-start gap-space-3 rounded-xl border border-outline-variant bg-surface-container-low p-space-4">
          <CheckCircle2 className="h-5 w-5 text-tertiary shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <p className="text-body-md text-on-surface font-medium">Password changed</p>
            <p className="text-body-sm text-on-surface-variant">
              Every session was signed out. Taking you to sign in…
            </p>
          </div>
        </div>
        <Link href="/login" className="text-body-sm text-primary font-medium hover:underline">
          Sign in now
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

      <Field label="New password" htmlFor="password" required error={fieldErrors.newPassword}>
        <Input
          id="password" type="password" autoComplete="new-password" required autoFocus
          value={password} onChange={(e) => setPassword(e.target.value)}
          invalid={Boolean(fieldErrors.newPassword)}
        />
      </Field>

      {password.length > 0 ? (
        <ul className="grid grid-cols-2 gap-x-space-4 gap-y-1 -mt-space-3">
          {checks.map((c) => (
            <li key={c.label} className={`text-label-md ${c.ok ? 'text-tertiary' : 'text-on-surface-variant'}`}>
              <span aria-hidden>{c.ok ? '✓' : '·'}</span> {c.label}
            </li>
          ))}
        </ul>
      ) : null}

      <Field
        label="Confirm new password" htmlFor="confirm" required
        error={fieldErrors.confirmPassword ?? (confirm && !matches ? 'Passwords do not match' : undefined)}
      >
        <Input
          id="confirm" type="password" autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)}
          invalid={Boolean(confirm) && !matches}
        />
      </Field>

      <Button
        type="submit" className="w-full" loading={loading} disabled={!ready || !matches}
        icon={<KeyRound className="h-4 w-4" aria-hidden />}
      >
        Set new password
      </Button>
    </form>
  );
}
