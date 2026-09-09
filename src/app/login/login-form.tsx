'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldCheck } from 'lucide-react';
import { authApi, referenceApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui';

/**
 * Demonstration accounts — development only, and not configurable in production.
 *
 * This panel puts a shared password into the client bundle and a list of
 * pre-made identities onto the sign-in screen. Both are fine for a walkthrough
 * on a laptop and neither belongs on the front door of a system that holds real
 * records.
 *
 * It used to be governed by NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS alone. That is one
 * stale variable in a hosting dashboard away from advertising credentials to
 * every visitor — and the variable is baked in at build time, so the mistake
 * survives until somebody notices and redeploys. The build now refuses to
 * render it at all in production, whatever the variable says.
 */
const DEMO_ACCOUNTS = [
  { email: 'doctor@caresync.demo', label: 'Senior Doctor', name: 'Dr. Aarav Sharma' },
  { email: 'specialist@caresync.demo', label: 'Specialist (Cardiology)', name: 'Dr. Priya Mehta' },
  { email: 'junior@caresync.demo', label: 'Junior Doctor', name: 'Dr. Kavya Iyer' },
  { email: 'nurse@caresync.demo', label: 'Nurse', name: 'Sister Meera Nair' },
  { email: 'radiology@caresync.demo', label: 'Radiology', name: 'Dr. Rohan Desai' },
  { email: 'pathology@caresync.demo', label: 'Pathology', name: 'Dr. Ananya Bose' },
  { email: 'pharmacy@caresync.demo', label: 'Pharmacy', name: 'Vikram Shah' },
  { email: 'admin@caresync.demo', label: 'Hospital Admin', name: 'Neha Kulkarni' },
];

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  // Both conditions are compile-time constants, so the whole panel — and the
  // password with it — is eliminated from the production bundle rather than
  // merely hidden in it.
  const showDemo = process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'true';
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'CareSync#2026';

  // An empty deployment has no administrator, so a sign-in form that cannot
  // work and a registration nobody can approve are both correct and both look
  // like faults. Say so instead.
  const [needsSetup, setNeedsSetup] = React.useState(false);
  React.useEffect(() => {
    referenceApi.setupStatus()
      .then(({ data }) => setNeedsSetup(!data.initialised))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const { data } = await authApi.login({ email, password });
      router.replace(next && next.startsWith('/') ? next : data.redirectTo);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries(err.issues.map((i) => [i.field, i.message])));
      } else {
        setError('Could not sign in. Please try again.');
      }
      setLoading(false);
    }
  }

  function fillDemoAccount(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError(null);
  }

  return (
    <div className="space-y-space-6">
      {needsSetup ? (
        <div className="flex items-start gap-space-3 p-space-4 rounded-xl border border-outline-variant bg-surface-container-low">
          <ShieldCheck className="h-5 w-5 mt-0.5 shrink-0 text-secondary" aria-hidden />
          <div className="space-y-1">
            <p className="text-body-md font-medium text-on-surface">This hospital has not been set up yet</p>
            <p className="text-body-sm text-on-surface-variant">
              There are no accounts on this deployment. The operator creates the first
              administrator once, using the bootstrap token from the server
              configuration; everybody else is invited or approved by a person after
              that. Registrations submitted now will wait until an administrator exists.
            </p>
          </div>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-space-4" noValidate>
        {error ? (
          <div role="alert" className="flex items-start gap-space-3 p-space-3 rounded-lg bg-error-container text-on-error-container text-body-sm">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <Field label="Email address" htmlFor="email" error={fieldErrors.email} required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="you@hospital.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={!!fieldErrors.email}
          />
        </Field>

        <div className="flex items-baseline justify-between">
          <span aria-hidden />
          <Link
            href="/forgot-password"
            className="text-label-md text-primary font-medium hover:underline"
          >
            Forgot your password?
          </Link>
        </div>

        <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={!!fieldErrors.password}
          />
        </Field>

        <Button type="submit" size="lg" loading={loading} icon={<LogIn className="h-4 w-4" />} className="w-full">
          {loading ? 'Signing in' : 'Sign in'}
        </Button>

        <div className="text-center pt-space-1 space-y-1">
          <p className="text-body-sm text-on-surface-variant">
            New to CareSync?{' '}
            <Link href="/register" className="text-primary font-medium hover:underline">
              Create an account
            </Link>
          </p>
          {/* The first question anybody has on a sign-in page they have not used
              before is whether it is for them. Answer it here rather than making
              them click through to find out. */}
          <p className="text-label-md text-outline">
            Doctors, nurses, radiology, pathology, pharmacy and staff administration.
          </p>
        </div>
      </form>

      {showDemo ? (
        <div className="pt-space-6 border-t border-outline-variant/60">
          <p className="text-label-md text-outline uppercase tracking-wider font-semibold mb-space-3">
            Demonstration accounts
          </p>
          <div className="grid sm:grid-cols-2 gap-space-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fillDemoAccount(a.email)}
                className="text-left px-space-3 py-space-2 rounded-lg border border-outline-variant/70 bg-surface-container-lowest
                           hover:border-secondary hover:bg-secondary-fixed/25 transition-colors"
              >
                <span className="block text-body-sm font-semibold text-on-surface">{a.label}</span>
                <span className="block text-label-md text-outline truncate">{a.name}</span>
              </button>
            ))}
          </div>
          <p className="text-label-md text-outline mt-space-3">
            Selecting an account fills in the shared demonstration password.
            This panel only appears when NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true.
          </p>
        </div>
      ) : null}
    </div>
  );
}
