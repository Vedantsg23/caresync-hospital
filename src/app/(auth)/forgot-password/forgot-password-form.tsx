'use client';

import * as React from 'react';
import Link from 'next/link';
import { Mail, MailCheck } from 'lucide-react';
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui';

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      // A rate limit is worth surfacing; anything else must not hint at whether
      // the address exists, so the success state is shown regardless.
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') setError(err.message);
      else setSent(true);
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-space-6">
        <div className="flex items-start gap-space-3 rounded-xl border border-outline-variant bg-surface-container-low p-space-4">
          <MailCheck className="h-5 w-5 text-tertiary shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <p className="text-body-md text-on-surface font-medium">Check your email</p>
            <p className="text-body-sm text-on-surface-variant">
              If an account exists for <span className="font-medium text-on-surface">{email}</span>,
              a reset link is on its way. It expires in 30 minutes and can be used once.
            </p>
          </div>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Nothing arrived? Check spam, then try again — requesting a new link cancels the previous one.
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
        <p role="alert" className="text-body-sm text-error">{error}</p>
      ) : null}

      <Field label="Work email address" htmlFor="email" required>
        <Input
          id="email" name="email" type="email" autoComplete="email" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@hospital.org"
        />
      </Field>

      <Button type="submit" className="w-full" loading={loading} icon={<Mail className="h-4 w-4" aria-hidden />}>
        Send reset link
      </Button>

      <p className="text-body-sm text-on-surface-variant text-center">
        Remembered it?{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
