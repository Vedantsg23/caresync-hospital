'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldCheck } from 'lucide-react';
import { authApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Button, Field, Input } from '@/components/ui';

/**
 * Demonstration accounts.
 *
 * This panel puts a shared password into the client bundle, which is fine for a
 * public demo and unacceptable for a real hospital deployment. Set
 * NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false to remove it (and reseed with a private
 * SEED_DEMO_PASSWORD) before putting this in front of real users.
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
  const showDemo = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS !== 'false';
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'CareSync#2026';

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
            placeholder="you@caresync.demo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={!!fieldErrors.email}
          />
        </Field>

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
            This panel is disabled by setting NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false.
          </p>
        </div>
      ) : null}
    </div>
  );
}
