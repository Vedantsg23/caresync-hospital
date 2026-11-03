import { BrandPanel, MobileWordmark } from './brand-panel';

/**
 * The panel that every account page shares with sign-in.
 *
 * Registration, verification and password recovery are the first thing a new
 * member of staff sees, and they should not look like a different product from
 * the application they are joining. This reuses the sign-in layout and its
 * brand panel exactly, so the only thing that changes between pages is the
 * form on the right.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel
        heading={<>One hospital.<br />One connected view of the patient.</>}
        body="Every account is reviewed before it is granted access. Clinical roles are assigned by a hospital administrator, never chosen by the person registering."
        points={[
          'Email confirmation, then administrator approval',
          'Role-based access with a full audit trail',
          'Every sign-in and access decision recorded',
        ]}
        footnote="Handles sensitive clinical information. Access is logged."
      />

      <section className="flex items-center justify-center p-space-6 sm:p-space-12 bg-surface">
        <div className="w-full max-w-md">
          <MobileWordmark />

          <h2 className="text-headline-lg text-on-surface font-semibold">{title}</h2>
          {subtitle ? (
            <p className="text-body-md text-on-surface-variant mt-1 mb-space-8">{subtitle}</p>
          ) : <div className="mb-space-8" />}

          {children}

          {footer ? <div className="mt-space-8">{footer}</div> : null}
        </div>
      </section>
    </main>
  );
}
