'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldAlert, Loader2, Clock } from 'lucide-react';
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui';

type State =
  | { kind: 'working' }
  | { kind: 'done'; message: string; status: string }
  | { kind: 'failed'; message: string };

export function VerifyEmailClient({ token }: { token: string }) {
  const [state, setState] = React.useState<State>(
    token ? { kind: 'working' } : { kind: 'failed', message: 'This page needs a confirmation link.' },
  );
  const [email, setEmail] = React.useState('');
  const [resent, setResent] = React.useState(false);
  const [resending, setResending] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    authApi.verifyEmail({ token })
      .then(({ data }) => {
        if (!cancelled) setState({ kind: 'done', message: data.message, status: data.status });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: 'failed',
          message: err instanceof ApiError
            ? err.message
            : 'This confirmation link is invalid or has expired.',
        });
      });
    return () => { cancelled = true; };
  }, [token]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setResending(true);
    try {
      await authApi.resendVerification({ email });
      setResent(true);
    } catch {
      setResent(true); // Same answer either way — no address enumeration.
    } finally {
      setResending(false);
    }
  }

  if (state.kind === 'working') {
    return (
      <div className="flex items-center gap-space-3 text-on-surface-variant">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        <span className="text-body-md">Confirming your address…</span>
      </div>
    );
  }

  if (state.kind === 'done') {
    const awaiting = state.status !== 'ACTIVE';
    return (
      <div className="space-y-space-6">
        <div className="flex items-start gap-space-3 rounded-xl border border-outline-variant bg-surface-container-low p-space-4">
          {awaiting
            ? <Clock className="h-5 w-5 text-secondary shrink-0 mt-0.5" aria-hidden />
            : <CheckCircle2 className="h-5 w-5 text-tertiary shrink-0 mt-0.5" aria-hidden />}
          <div className="space-y-1">
            <p className="text-body-md text-on-surface font-medium">
              {awaiting ? 'Email confirmed — awaiting approval' : 'Email confirmed'}
            </p>
            <p className="text-body-sm text-on-surface-variant">{state.message}</p>
          </div>
        </div>
        {awaiting ? (
          <p className="text-body-sm text-on-surface-variant">
            A hospital administrator now reviews your request and assigns your role and department.
            You will be emailed when that happens. Signing in before then will not work — this is
            deliberate, not a fault.
          </p>
        ) : null}
        <Link href="/login" className="text-body-sm text-primary font-medium hover:underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-space-6">
      <div role="alert" className="flex items-start gap-space-3 rounded-xl border border-error/30 bg-error-container/40 p-space-4">
        <ShieldAlert className="h-5 w-5 text-error shrink-0 mt-0.5" aria-hidden />
        <p className="text-body-sm text-on-error-container">{state.message}</p>
      </div>

      {resent ? (
        <p className="text-body-sm text-on-surface-variant">
          If that address still needs confirming, a fresh link is on its way. It replaces any earlier one.
        </p>
      ) : (
        <form onSubmit={resend} className="space-y-space-4">
          <Field label="Send a new confirmation link" htmlFor="email">
            <Input
              id="email" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@hospital.org"
            />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" loading={resending}>
            Resend confirmation
          </Button>
        </form>
      )}

      <Link href="/login" className="text-body-sm text-primary font-medium hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
