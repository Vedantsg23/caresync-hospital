import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { ROLE_HOME } from '@/types/rbac';
import { BrandPanel, MobileWordmark } from '@/app/(auth)/brand-panel';
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
      {/*
        The footnote used to read "Demonstration environment. Contains no real
        patient information." That was true of a seeded demo and is a lie on a
        deployment people actually use — and the wrong lie, because it invites
        someone to treat a real record casually. It says what is true of every
        deployment: this handles clinical information and every access is
        recorded.
      */}
      <BrandPanel
        heading={<>One hospital.<br />One connected view of the patient.</>}
        body="Nursing observations, clinical notes, laboratory results, imaging reports, medication records and specialist referrals, brought together on one record, so no one has to ask where the information is."
        points={[
          'Role-based access with a full audit trail',
          'Doctor to specialist referrals, end to end',
          'Live updates across every department',
        ]}
        footnote="Handles sensitive clinical information. Every access is recorded."
      />

      {/* Form panel */}
      <section className="flex items-center justify-center p-space-6 sm:p-space-12 bg-surface">
        <div className="w-full max-w-md">
          <MobileWordmark />

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
