'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Stethoscope, Pill, Building2, BedDouble, BadgeCheck,
  BarChart3, HelpCircle, Send, FlaskConical, Scan, MessageSquare, ScrollText,
  ClipboardList, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers';
import { PERMISSIONS, type Permission } from '@/types/rbac';

type NavItem = { label: string; href: string; icon: React.ReactNode; permission?: Permission; roles?: string[] };
type NavGroup = { heading: string; items: NavItem[] };

const icon = (I: React.ComponentType<{ className?: string }>) => <I className="h-[18px] w-[18px] shrink-0" aria-hidden />;

/**
 * Role-aware navigation.
 *
 * Hiding an item is a usability decision, not a security one - the matching
 * API route enforces the same permission server-side, so a user who types the
 * URL still gets a 403.
 */
const NAV: NavGroup[] = [
  {
    heading: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: icon(LayoutDashboard) },
      { label: 'Nursing', href: '/nursing', icon: icon(ClipboardList), roles: ['NURSE'] },
    ],
  },
  {
    heading: 'Clinical',
    items: [
      { label: 'Patients', href: '/patients', icon: icon(Users), permission: PERMISSIONS.PATIENT_SEARCH },
      { label: 'Referrals', href: '/referrals', icon: icon(Send), permission: PERMISSIONS.REFERRAL_READ },
      { label: 'Pathology', href: '/pathology', icon: icon(FlaskConical), permission: PERMISSIONS.LAB_READ },
      { label: 'Radiology', href: '/radiology', icon: icon(Scan), permission: PERMISSIONS.RADIOLOGY_READ },
      { label: 'Pharmacy', href: '/pharmacy', icon: icon(Pill), permission: PERMISSIONS.MEDICATION_READ },
    ],
  },
  {
    heading: 'Hospital',
    items: [
      { label: 'Wards & Beds', href: '/wards', icon: icon(BedDouble), permission: PERMISSIONS.WARD_READ },
      { label: 'Messages', href: '/messages', icon: icon(MessageSquare), permission: PERMISSIONS.MESSAGE_READ },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Overview', href: '/admin', icon: icon(BarChart3), permission: PERMISSIONS.ADMIN_DASHBOARD },
      { label: 'Staff Management', href: '/admin/staff', icon: icon(BadgeCheck), permission: PERMISSIONS.USER_READ },
      { label: 'Departments', href: '/admin/departments', icon: icon(Building2), permission: PERMISSIONS.DEPARTMENT_MANAGE },
      { label: 'Audit Trail', href: '/admin/audit', icon: icon(ScrollText), permission: PERMISSIONS.AUDIT_READ },
    ],
  },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user, can } = useAuth();

  const visibleGroups = React.useMemo(() => {
    return NAV
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.roles && (!user || !item.roles.includes(user.role))) return false;
          if (item.permission && !can(item.permission)) return false;
          // Doctors and admins land on their own dashboards; nurses use /nursing.
          if (item.href === '/dashboard' && user?.role === 'NURSE') return false;
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [user, can]);

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && href !== '/admin' && pathname.startsWith(`${href}/`));

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 bg-primary-container/40 lg:hidden" onClick={onClose} aria-hidden />
      ) : null}

      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 bg-surface-container-low z-50 flex flex-col pt-space-6 pb-space-8',
          'transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="px-space-6 mb-space-8 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-space-2 rounded-lg">
            <span className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center" aria-hidden>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="#6ffbbe" strokeWidth="3" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="text-headline-md text-primary font-bold tracking-tight">CareSync</span>
          </Link>
          <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg text-outline hover:bg-surface-container-high" aria-label="Close navigation">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 px-space-4 space-y-space-1 overflow-y-auto cs-scroll">
          {visibleGroups.map((group) => (
            <div key={group.heading}>
              <div className="text-label-sm text-outline px-space-4 pt-space-4 pb-space-2 uppercase tracking-wider font-semibold">
                {group.heading}
              </div>
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-space-3 px-space-4 py-space-3 rounded-xl text-body-sm transition-all',
                      active
                        ? 'bg-primary text-on-primary font-bold'
                        : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-space-4 mt-auto pt-space-4">
          <Link
            href="/help"
            onClick={onClose}
            className="flex items-center gap-space-3 px-space-4 py-space-3 rounded-xl text-body-sm
                       text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-all"
          >
            {icon(HelpCircle)}
            Help &amp; Support
          </Link>
          {user ? (
            <div className="mt-space-3 mx-space-2 px-space-3 py-space-3 rounded-xl bg-surface-container">
              <div className="flex items-center gap-space-2 text-label-sm text-outline">
                {icon(Stethoscope)}
                <span className="truncate">{user.departmentName ?? 'No department'}</span>
              </div>
              <p className="text-body-sm font-semibold text-on-surface truncate mt-1">{user.fullName}</p>
              <p className="text-label-md text-outline truncate">{user.designation ?? user.role}</p>
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
}
