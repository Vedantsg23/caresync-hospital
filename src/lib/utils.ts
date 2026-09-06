import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The design system names its type scale `text-body-sm`, `text-headline-md` and
 * so on, which collides with Tailwind's `text-<color>` utilities as far as
 * tailwind-merge is concerned: without this, `text-body-sm` and `text-on-primary`
 * are treated as the same class group and the colour is silently dropped —
 * producing dark text on a dark button. Registering the scale as font sizes
 * keeps size and colour in separate groups.
 */
const TYPE_SCALE = [
  'headline-xl', 'headline-lg', 'headline-md', 'headline-sm',
  'body-lg', 'body-md', 'body-sm',
  'label-md', 'label-sm', 'code-md',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: TYPE_SCALE }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatDate(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "2 min ago", "3 h ago", "yesterday" - the granularity a ward round needs. */
export function timeAgo(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
}

export function initials(name: string): string {
  return name
    .replace(/^(Dr\.?|Sister|Nurse|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function calculateAge(dateOfBirth: string | Date): number {
  const d = toDate(dateOfBirth);
  if (!d) return 0;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export const titleCase = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export const bloodGroupLabel = (v: string) =>
  v === 'UNKNOWN' ? 'Unknown' : v.replace('_POSITIVE', '+').replace('_NEGATIVE', '-');

export const genderLabel = (v: string) =>
  v === 'MALE' ? 'M' : v === 'FEMALE' ? 'F' : v === 'OTHER' ? 'X' : '?';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a vitals set the way it reads on an observation chart. */
export function vitalsSummary(v: {
  bloodPressureSystolic?: number | null;
  bloodPressureDiastolic?: number | null;
  heartRate?: number | null;
  spo2?: number | null;
  temperatureC?: number | null;
} | null | undefined): string {
  if (!v) return 'No observations recorded';
  const parts = [
    v.bloodPressureSystolic && v.bloodPressureDiastolic ? `BP ${v.bloodPressureSystolic}/${v.bloodPressureDiastolic} mmHg` : null,
    v.heartRate ? `HR ${v.heartRate} bpm` : null,
    v.spo2 ? `SpO2 ${v.spo2}%` : null,
    v.temperatureC ? `${v.temperatureC} °C` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No observations recorded';
}

export const isoDateInput = (d: Date = new Date()) => d.toISOString().slice(0, 10);
