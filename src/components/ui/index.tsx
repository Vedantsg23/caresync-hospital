'use client';

import * as React from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CareSync component primitives.
 * Built directly on the Stitch design tokens (surface layers, ghost borders,
 * restrained radii, pill badges reserved for status) so the generated design
 * survives being made functional.
 */

/* ------------------------------------------------------------- button --- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:opacity-90 disabled:opacity-40',
  secondary: 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest disabled:opacity-50',
  ghost: 'bg-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
  danger: 'bg-error text-on-error hover:opacity-90 disabled:opacity-40',
  accent: 'bg-tertiary-fixed text-on-tertiary-fixed hover:opacity-90 disabled:opacity-40',
  outline: 'bg-transparent border border-outline-variant text-on-surface hover:bg-surface-container-low',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-space-3 py-1.5 text-body-sm gap-1.5',
  md: 'px-space-4 py-2 text-body-sm gap-space-2',
  lg: 'px-space-4 py-2.5 text-body-md gap-space-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-semibold transition-all',
        'disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1',
        buttonVariants[variant], buttonSizes[size], className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* --------------------------------------------------------------- card --- */

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/40', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: {
  title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-space-4 px-space-6 py-space-4 border-b border-outline-variant/40', className)}>
      <div className="min-w-0">
        <h2 className="text-headline-sm text-on-surface font-semibold truncate">{title}</h2>
        {subtitle ? <p className="text-body-sm text-on-surface-variant mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- badge --- */

type BadgeTone = 'neutral' | 'critical' | 'attention' | 'success' | 'info' | 'muted';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-container-high text-on-surface',
  critical: 'bg-error-container text-on-error-container',
  attention: 'bg-warning-container text-on-warning-container',
  success: 'bg-tertiary-fixed/45 text-on-tertiary-fixed-variant',
  info: 'bg-secondary-fixed text-on-secondary-fixed-variant',
  muted: 'bg-surface-container text-outline',
};

export function Badge({ tone = 'neutral', className, children, dot }: {
  tone?: BadgeTone; className?: string; children: React.ReactNode; dot?: boolean;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-space-2.5 py-0.5 rounded-full text-label-sm font-semibold whitespace-nowrap',
      badgeTones[tone], className,
    )}>
      {dot ? <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" aria-hidden /> : null}
      {children}
    </span>
  );
}

export const patientStatusTone = (status: string): BadgeTone =>
  status === 'CRITICAL' ? 'critical' : status === 'NEEDS_ATTENTION' ? 'attention' : 'success';

export const referralStatusTone = (status: string): BadgeTone =>
  status === 'PENDING' ? 'info'
  : status === 'ACCEPTED' || status === 'IN_PROGRESS' ? 'attention'
  : status === 'COMPLETED' ? 'success'
  : status === 'REQUESTED_INFORMATION' ? 'attention'
  : status === 'DECLINED' || status === 'CANCELLED' ? 'muted'
  : 'neutral';

export const priorityTone = (priority: string): BadgeTone =>
  priority === 'EMERGENCY' ? 'critical' : priority === 'URGENT' || priority === 'STAT' ? 'attention' : 'muted';

export const resultFlagTone = (flag: string): BadgeTone =>
  flag.startsWith('CRITICAL') ? 'critical' : flag === 'NORMAL' ? 'success' : 'attention';

/* -------------------------------------------------------------- input --- */

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, required, className, children, htmlFor }: FieldProps) {
  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="cs-label">
          {label}
          {required ? <span className="text-error ml-0.5">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-label-md text-error flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />{error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-label-md text-outline">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return <input ref={ref} className={cn('cs-input', invalid && 'border-error focus:ring-error focus:border-error', className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...props }, ref) {
    return <textarea ref={ref} className={cn('cs-input min-h-[96px] resize-y', invalid && 'border-error focus:ring-error', className)} {...props} />;
  },
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...props }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn('cs-input appearance-none pr-9', invalid && 'border-error focus:ring-error', className)} {...props}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" aria-hidden />
      </div>
    );
  },
);

/* ------------------------------------------------------------- states --- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('cs-skeleton h-4 w-full', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading', rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-space-3 p-space-6', className)} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-space-6 py-space-12', className)}>
      {icon ? <div className="mb-space-3 text-outline-variant">{icon}</div> : null}
      <p className="text-body-md font-semibold text-on-surface">{title}</p>
      {description ? <p className="text-body-sm text-on-surface-variant mt-1 max-w-md">{description}</p> : null}
      {action ? <div className="mt-space-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className }: {
  title?: string; message?: string; onRetry?: () => void; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-space-6 py-space-12', className)} role="alert">
      <div className="mb-space-3 w-10 h-10 rounded-full bg-error-container flex items-center justify-center">
        <AlertTriangle className="h-5 w-5 text-on-error-container" aria-hidden />
      </div>
      <p className="text-body-md font-semibold text-on-surface">{title}</p>
      {message ? <p className="text-body-sm text-on-surface-variant mt-1 max-w-md">{message}</p> : null}
      {onRetry ? <Button variant="secondary" size="sm" className="mt-space-4" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}

/* -------------------------------------------------------------- modal --- */

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-space-4 sm:p-space-8">
      <div className="fixed inset-0 bg-primary-container/45 backdrop-blur-[2px] animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cs-modal-title"
        className={cn('relative w-full bg-surface-container-lowest rounded-xl shadow-overlay animate-slide-up my-auto', widths[size])}
      >
        <div className="flex items-start justify-between gap-space-4 px-space-6 py-space-4 border-b border-outline-variant/50">
          <div className="min-w-0">
            <h2 id="cs-modal-title" className="text-headline-md text-on-surface font-semibold">{title}</h2>
            {description ? <p className="text-body-sm text-on-surface-variant mt-1">{description}</p> : null}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-outline hover:bg-surface-container-high hover:text-on-surface transition-colors">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-space-6 py-space-6 max-h-[65vh] overflow-y-auto cs-scroll">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-space-3 px-space-6 py-space-4 border-t border-outline-variant/50 bg-surface-container-low/60 rounded-b-xl">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- tabs --- */

export function Tabs({ tabs, active, onChange, className }: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string; onChange: (id: string) => void; className?: string;
}) {
  return (
    <div className={cn('border-b border-outline-variant/60 overflow-x-auto cs-scroll', className)} role="tablist">
      <div className="flex items-center gap-space-1 min-w-max">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(t.id)}
              className={cn(
                'relative px-space-4 py-space-3 text-body-sm font-medium transition-colors whitespace-nowrap',
                isActive ? 'text-on-surface' : 'text-outline hover:text-on-surface-variant',
              )}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 ? (
                <span className={cn('ml-1.5 px-1.5 py-0.5 rounded-full text-label-sm',
                  isActive ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant')}>
                  {t.count}
                </span>
              ) : null}
              {isActive ? <span className="absolute inset-x-space-3 -bottom-px h-0.5 bg-primary rounded-full" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- toasts --- */

export type Toast = { id: string; title: string; description?: string; tone: 'success' | 'error' | 'info' };

export function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="fixed bottom-space-6 right-space-6 z-[200] flex flex-col gap-space-2 w-[min(24rem,calc(100vw-3rem))]" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'flex items-start gap-space-3 p-space-4 rounded-xl shadow-overlay animate-slide-in-right border',
            t.tone === 'error' ? 'bg-error-container border-error/20 text-on-error-container'
            : t.tone === 'success' ? 'bg-surface-container-lowest border-tertiary-fixed-dim/60 text-on-surface'
            : 'bg-surface-container-lowest border-outline-variant text-on-surface',
          )}
        >
          <div className="mt-0.5 shrink-0">
            {t.tone === 'error' ? <AlertTriangle className="h-4 w-4" aria-hidden />
              : t.tone === 'success' ? <Check className="h-4 w-4 text-on-tertiary-fixed-variant" aria-hidden />
              : <Info className="h-4 w-4 text-secondary" aria-hidden />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-semibold">{t.title}</p>
            {t.description ? <p className="text-body-sm opacity-80 mt-0.5 break-words">{t.description}</p> : null}
          </div>
          <button onClick={() => onDismiss(t.id)} aria-label="Dismiss" className="p-1 rounded hover:bg-black/5 shrink-0">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ display --- */

export function StatTile({ label, value, sublabel, tone = 'neutral', icon, className }: {
  label: string; value: React.ReactNode; sublabel?: React.ReactNode;
  tone?: 'neutral' | 'critical' | 'attention' | 'success'; icon?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn(
      'p-space-6 rounded-xl shadow-card border transition-all hover:-translate-y-0.5',
      tone === 'critical' ? 'bg-error-container/40 border-error/20'
        : tone === 'attention' ? 'bg-warning-container/50 border-warning/20'
        : 'bg-surface-container-lowest border-outline-variant/40',
      className,
    )}>
      <div className={cn('flex items-center justify-between mb-space-3',
        tone === 'critical' ? 'text-error' : tone === 'attention' ? 'text-on-warning-container' : 'text-outline')}>
        <span className="text-label-md uppercase tracking-wider font-semibold">{label}</span>
        {icon ? <span className={tone === 'neutral' ? 'text-secondary' : ''}>{icon}</span> : null}
      </div>
      <div className="flex items-baseline gap-space-2 flex-wrap">
        <span className={cn('text-headline-xl font-bold tabular-nums',
          tone === 'critical' ? 'text-error' : 'text-on-surface')}>{value}</span>
        {sublabel ? <span className="text-label-sm text-outline font-medium">{sublabel}</span> : null}
      </div>
    </div>
  );
}

export function Avatar({ name, tone = 'neutral', size = 'md' }: {
  name: string; tone?: 'neutral' | 'critical' | 'attention' | 'info'; size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'w-8 h-8 text-label-md', md: 'w-10 h-10 text-body-sm', lg: 'w-12 h-12 text-headline-sm' };
  const tones = {
    neutral: 'bg-surface-container-high text-on-surface',
    critical: 'bg-error-container text-on-error-container',
    attention: 'bg-warning-container text-on-warning-container',
    info: 'bg-secondary-container text-on-secondary-container',
  };
  return (
    <div className={cn('rounded-full flex items-center justify-center font-bold shrink-0', sizes[size], tones[tone])} aria-hidden>
      {name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
    </div>
  );
}

export function DataRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-space-4 py-1.5', className)}>
      <span className="text-body-sm text-on-surface-variant shrink-0">{label}</span>
      <span className="text-body-sm text-on-surface font-medium text-right min-w-0 break-words">{value}</span>
    </div>
  );
}

export function Section({ title, action, children, className }: {
  title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={cn('space-y-space-4', className)}>
      <div className="flex items-center justify-between gap-space-4">
        <h2 className="text-headline-md text-on-surface font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
