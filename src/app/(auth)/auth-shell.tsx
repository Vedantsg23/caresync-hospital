import Link from 'next/link';

/**
 * The panel that every account page shares with sign-in.
 *
 * Registration, verification and password recovery are the first thing a new
 * member of staff sees, and they should not look like a different product from
 * the application they are joining. This reuses the sign-in layout and its
 * Stitch surfaces exactly, so the only thing that changes between pages is the
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
      <section className="relative hidden lg:flex flex-col justify-between bg-primary-container text-on-primary-container p-space-12 overflow-hidden">
        <div
          className="absolute -right-24 -bottom-24 w-[36rem] h-[36rem] rounded-full blur-3xl pointer-events-none
                     bg-gradient-to-br from-tertiary-fixed/15 to-transparent"
          aria-hidden
        />
        <Link href="/login" className="relative z-10 flex items-center gap-space-3">
          <span className="w-9 h-9 rounded-lg bg-tertiary-fixed flex items-center justify-center" aria-hidden>
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="#002113" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="text-headline-md text-on-primary font-bold tracking-tight">CareSync</span>
        </Link>

        <div className="relative z-10 max-w-lg space-y-space-6">
          <h1 className="text-[40px] leading-[48px] font-semibold tracking-[-0.02em] text-on-primary">
            One hospital.<br />One connected view of the patient.
          </h1>
          <p className="text-body-lg text-primary-fixed-dim">
            Every account is reviewed before it is granted access. Clinical roles are assigned by a
            hospital administrator, never chosen by the person registering.
          </p>
          <ul className="space-y-space-3 text-body-md text-primary-fixed-dim">
            {[
              'Email confirmation, then administrator approval',
              'Role-based access with a full audit trail',
              'Every sign-in and access decision recorded',
            ].map((item) => (
              <li key={item} className="flex items-start gap-space-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-tertiary-fixed-dim shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-label-md text-on-primary-container">
          Handles sensitive clinical information. Access is logged.
        </p>
      </section>

      <section className="flex items-center justify-center p-space-6 sm:p-space-12 bg-surface">
        <div className="w-full max-w-md">
          <Link href="/login" className="lg:hidden flex items-center gap-space-2 mb-space-8">
            <span className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center" aria-hidden>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="#6ffbbe" strokeWidth="3" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="text-headline-md text-on-surface font-bold tracking-tight">CareSync</span>
          </Link>

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
