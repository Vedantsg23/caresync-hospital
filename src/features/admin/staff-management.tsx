'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Search, ShieldCheck, KeyRound, Power } from 'lucide-react';
import { adminApi, departmentsApi } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { useAuth, useToast, useErrorToast } from '@/components/providers';
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock,
  Modal, Select,
} from '@/components/ui';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import { ROLES, ROLE_LABELS, PERMISSIONS, type Role } from '@/types/rbac';
import type { StaffDto } from '@/types/api';

export function StaffManagement() {
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const { push } = useToast();
  const showError = useErrorToast();

  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState('');
  const [newOpen, setNewOpen] = React.useState(false);
  const [roleFor, setRoleFor] = React.useState<StaffDto | null>(null);
  const [resetFor, setResetFor] = React.useState<StaffDto | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['staff', q, role],
    queryFn: () => adminApi.listStaff({ q: q || undefined, role: role || undefined }),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.setActive(id, isActive),
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      push({
        title: vars.isActive ? 'Account activated' : 'Account deactivated',
        description: vars.isActive ? undefined : 'Their sessions have been revoked immediately.',
        tone: 'success',
      });
    },
    onError: (e) => showError(e, 'The account could not be updated.'),
  });

  const staff = data?.data ?? [];

  return (
    <div className="space-y-space-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-4">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Staff management</h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            Accounts, roles and departments. Every role change is audited and revokes the target&apos;s sessions.
          </p>
        </div>
        {can(PERMISSIONS.USER_CREATE) ? (
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>Add staff member</Button>
        ) : null}
      </div>

      <Card className="p-space-4">
        <div className="grid md:grid-cols-[1fr_220px] gap-space-3">
          <div className="relative">
            <Search className="absolute left-space-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search staff" className="pl-10" />
          </div>
          <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? <LoadingBlock rows={5} />
          : isError ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
          : staff.length === 0 ? <EmptyState title="No staff match those filters" />
          : (
            <div className="overflow-x-auto cs-scroll">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="text-left border-b border-outline-variant/40">
                    {['Staff member', 'Role', 'Department', 'Staff number', 'Last sign-in', 'Status', ''].map((h) => (
                      <th key={h} className="px-space-5 py-space-3 text-label-md font-semibold text-outline uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/30">
                  {staff.map((s) => (
                    <tr key={s.id} className={cn('text-body-sm', !s.isActive && 'opacity-60')}>
                      <td className="px-space-5 py-space-3">
                        <div className="flex items-center gap-space-3 min-w-0">
                          <Avatar name={s.fullName} size="sm" />
                          <div className="min-w-0">
                            <span className="block font-semibold text-on-surface truncate">{s.fullName}</span>
                            <span className="block text-label-md text-outline truncate">{s.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-space-5 py-space-3">
                        <Badge tone={s.role === 'SUPER_ADMIN' || s.role === 'HOSPITAL_ADMIN' ? 'info' : 'muted'}>
                          {ROLE_LABELS[s.role]}
                        </Badge>
                        {s.designation ? <span className="block text-label-md text-outline mt-1">{s.designation}</span> : null}
                      </td>
                      <td className="px-space-5 py-space-3 text-on-surface-variant">{s.departmentName ?? '—'}</td>
                      <td className="px-space-5 py-space-3 font-mono text-outline">{s.staffNumber ?? '—'}</td>
                      <td className="px-space-5 py-space-3 text-outline">
                        {s.lastLoginAt ? timeAgo(s.lastLoginAt) : 'Never'}
                        {s.activeSessions > 0 ? <Badge tone="success" className="ml-2">{s.activeSessions} active</Badge> : null}
                      </td>
                      <td className="px-space-5 py-space-3">
                        <Badge tone={s.isActive ? 'success' : 'muted'}>{s.isActive ? 'Active' : 'Deactivated'}</Badge>
                      </td>
                      <td className="px-space-5 py-space-3">
                        <div className="flex items-center justify-end gap-space-1">
                          {can(PERMISSIONS.USER_ROLE_CHANGE) && s.id !== user?.id ? (
                            <Button variant="ghost" size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setRoleFor(s)}>
                              Role
                            </Button>
                          ) : null}
                          {can(PERMISSIONS.USER_UPDATE) ? (
                            <Button variant="ghost" size="sm" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetFor(s)}>
                              Password
                            </Button>
                          ) : null}
                          {can(PERMISSIONS.USER_UPDATE) && s.id !== user?.id ? (
                            <Button variant="ghost" size="sm" icon={<Power className="h-3.5 w-3.5" />}
                              loading={setActive.isPending}
                              onClick={() => setActive.mutate({ id: s.id, isActive: !s.isActive })}>
                              {s.isActive ? 'Disable' : 'Enable'}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <NewStaffModal open={newOpen} onClose={() => setNewOpen(false)} />
      {roleFor ? <ChangeRoleModal staff={roleFor} onClose={() => setRoleFor(null)} /> : null}
      {resetFor ? <ResetPasswordModal staff={resetFor} onClose={() => setResetFor(null)} /> : null}
    </div>
  );
}

function NewStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [issues, setIssues] = React.useState<Record<string, string>>({});
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.list(), enabled: open });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => adminApi.createStaff(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      push({ title: 'Staff member created', description: 'They can sign in with the password you set.', tone: 'success' });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setIssues(Object.fromEntries(e.issues.map((i) => [i.field, i.message])));
      showError(e, 'The account could not be created.');
    },
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssues({});
    const form = new FormData(e.currentTarget);
    const departmentId = String(form.get('departmentId') ?? '');
    mutation.mutate({
      email: String(form.get('email')).trim(),
      fullName: String(form.get('fullName')).trim(),
      password: String(form.get('password')),
      role: String(form.get('role')),
      departmentId: departmentId || undefined,
      designation: String(form.get('designation')).trim(),
      specialization: String(form.get('specialization') ?? '').trim() || undefined,
      registrationNumber: String(form.get('registrationNumber') ?? '').trim() || undefined,
      phone: String(form.get('phone') ?? '').trim() || undefined,
      acceptsReferrals: form.get('acceptsReferrals') === 'on',
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a staff member"
      description="Creates the account and its clinical profile. The role determines what they can see and do."
      size="lg"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="staff-form" loading={mutation.isPending}>Create account</Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={submit} className="space-y-space-4" noValidate>
        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Full name" htmlFor="fullName" required error={issues.fullName}>
            <Input id="fullName" name="fullName" required placeholder="Dr. Priya Mehta" autoFocus invalid={!!issues.fullName} />
          </Field>
          <Field label="Email" htmlFor="email" required error={issues.email}>
            <Input id="email" name="email" type="email" required placeholder="priya.mehta@caresync.demo" invalid={!!issues.email} />
          </Field>
        </div>

        <Field label="Temporary password" htmlFor="password" required error={issues.password}
          hint="At least 10 characters with upper case, lower case and a number.">
          <Input id="password" name="password" type="password" required minLength={10} invalid={!!issues.password} />
        </Field>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Role" htmlFor="role" required error={issues.role}>
            <Select id="role" name="role" required defaultValue="">
              <option value="" disabled>Select a role</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          <Field label="Department" htmlFor="departmentId">
            <Select id="departmentId" name="departmentId" defaultValue="">
              <option value="">No department</option>
              {(departments.data?.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Designation" htmlFor="designation" required error={issues.designation}>
            <Input id="designation" name="designation" required placeholder="Consultant Cardiologist" invalid={!!issues.designation} />
          </Field>
          <Field label="Specialisation" htmlFor="specialization">
            <Input id="specialization" name="specialization" placeholder="Interventional Cardiology" />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Registration number" htmlFor="registrationNumber">
            <Input id="registrationNumber" name="registrationNumber" placeholder="MC-100137" />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" />
          </Field>
        </div>

        <label className="flex items-center gap-space-2 text-body-sm text-on-surface">
          <input type="checkbox" name="acceptsReferrals" defaultChecked className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-secondary" />
          Available to receive specialist referrals
        </label>
      </form>
    </Modal>
  );
}

function ChangeRoleModal({ staff, onClose }: { staff: StaffDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [role, setRole] = React.useState<Role>(staff.role);

  const mutation = useMutation({
    mutationFn: () => adminApi.changeRole(staff.id, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      push({
        title: 'Role changed',
        description: `${staff.fullName} is now ${ROLE_LABELS[role]}. Their sessions have been revoked and the change is audited.`,
        tone: 'success',
      });
      onClose();
    },
    onError: (e) => showError(e, 'The role could not be changed.'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Change role for ${staff.fullName}`}
      description="This takes effect immediately: their active sessions are revoked and the change is written to the audit trail."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={role === staff.role}>
            Change role
          </Button>
        </>
      }
    >
      <Field label="New role" htmlFor="new-role" hint={`Currently ${ROLE_LABELS[staff.role]}.`}>
        <Select id="new-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}

function ResetPasswordModal({ staff, onClose }: { staff: StaffDto; onClose: () => void }) {
  const { push } = useToast();
  const showError = useErrorToast();
  const [password, setPassword] = React.useState('');
  const [issue, setIssue] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => adminApi.resetPassword(staff.id, password),
    onSuccess: () => {
      push({
        title: 'Password reset',
        description: `${staff.fullName} must sign in again with the new password.`,
        tone: 'success',
      });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setIssue(e.message);
      showError(e, 'The password could not be reset.');
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password for ${staff.fullName}`}
      description="All of their sessions are revoked. Communicate the new password through a secure channel."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={password.length < 10}>
            Reset password
          </Button>
        </>
      }
    >
      <Field label="New password" htmlFor="reset-password" required error={issue ?? undefined}
        hint="At least 10 characters with upper case, lower case and a number.">
        <Input id="reset-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          minLength={10} autoFocus invalid={!!issue} />
      </Field>
      <p className="text-label-md text-outline mt-space-3">
        Account created {formatDateTime(staff.createdAt)}.
      </p>
    </Modal>
  );
}
