import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { ROLE_HOME } from '@/types/rbac';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(ROLE_HOME[user.role] ?? '/dashboard');

  const { next } = await searchParams;

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel - carries the Stitch primary-container surface */}
      <section className="relative hidden lg:flex flex-col justify-between bg-primary-container text-on-primary-container p-space-12 overflow-hidden">
        <div
          className="absolute -right-24 -bottom-24 w-[36rem] h-[36rem] rounded-full blur-3xl pointer-events-none
                     bg-gradient-to-br from-tertiary-fixed/15 to-transparent"
          aria-hidden
        />
        <div className="relative z-10 flex items-center gap-space-3">
          <span className="w-9 h-9 rounded-lg bg-tertiary-fixed flex items-center justify-center" aria-hidden>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#002113" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="text-headline-md text-on-primary font-bold tracking-tight">CareSync</span>
        </div>

        <div className="relative z-10 max-w-lg space-y-space-6">
          <h1 className="text-[40px] leading-[48px] font-semibold tracking-[-0.02em] text-on-primary">
            One hospital.<br />One connected view of the patient.
          </h1>
          <p className="text-body-lg text-primary-fixed-dim">
            Nursing observations, clinical notes, laboratory results, imaging reports, medication
            records and specialist referrals — brought together on one record, so no one has to
            ask where the information is.
          </p>
          <ul className="space-y-space-3 text-body-md text-primary-fixed-dim">
            {[
              'Role-based access with a full audit trail',
              'Doctor to specialist referrals, end to end',
              'Live updates across every department',
            ].map((item) => (
              <li key={item} className="flex items-start gap-space-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-tertiary-fixed-dim shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/*
          The footer used to read "Demonstration environment. Contains no real
          patient information." That was true of a seeded demo and is a lie on a
          deployment people actually use — and the wrong lie, because it invites
          someone to treat a real record casually. It now says what is true of
          every deployment: this handles clinical information and every access is
          recorded.
        */}
        <p className="relative z-10 text-label-md text-on-primary-container">
          Handles sensitive clinical information. Every access is recorded.
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center p-space-6 sm:p-space-12 bg-surface">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-space-2 mb-space-8">
            <span className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center" aria-hidden>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="#6ffbbe" strokeWidth="3" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="text-headline-md text-on-surface font-bold tracking-tight">CareSync</span>
          </div>

          <h2 className="text-headline-lg text-on-surface font-semibold">Sign in</h2>
          <p className="text-body-md text-on-surface-variant mt-1 mb-space-8">
            Use your hospital credentials to continue.
          </p>

          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
