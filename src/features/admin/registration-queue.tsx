'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck, UserX, Mail, Clock, ShieldQuestion, Send } from 'lucide-react';
import { registrationsApi, departmentsApi, type PendingAccountDto } from '@/lib/api/endpoints';
import { useAuth, useToast, useErrorToast } from '@/components/providers';
import {
  Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock,
  Modal, Select,
} from '@/components/ui';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { ROLES, ROLE_LABELS, PERMISSIONS, type Role } from '@/types/rbac';

/**
 * The approval queue.
 *
 * This screen is where privilege is actually granted, so it is built to make
 * the approver think rather than click. The role the applicant *asked for* is
 * shown as a claim, not a default: the approver picks the role explicitly, and
 * whatever they pick is what the server writes. The applicant's own words are
 * shown verbatim so there is something to verify them against.
 */
export function RegistrationQueue() {
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const { push } = useToast();
  const showError = useErrorToast();

  const [approving, setApproving] = React.useState<PendingAccountDto | null>(null);
  const [rejecting, setRejecting] = React.useState<PendingAccountDto | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const queue = useQuery({
    queryKey: ['admin', 'registrations'],
    queryFn: async () => (await registrationsApi.list({ limit: 50 })).data,
    refetchInterval: 60_000,
  });

  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: async () => (await departmentsApi.list()).data,
    staleTime: 5 * 60_000,
  });

  const approve = useMutation({
    mutationFn: async (vars: {
      id: string;
      role: string;
      departmentId?: string;
      designation?: string;
      specialization?: string;
      registrationNumber?: string;
      acceptsReferrals?: boolean;
    }) => (await registrationsApi.approve(vars.id, vars)).data,
    onSuccess: (data) => {
      push({ tone: 'success', title: 'Account approved', description: `${data.email} can now sign in as ${ROLE_LABELS[data.role as Role] ?? data.role}.` });
      setApproving(null);
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => showError(e, 'The account could not be approved.'),
  });

  const reject = useMutation({
    mutationFn: async (vars: { id: string; reason: string }) =>
      (await registrationsApi.reject(vars.id, { reason: vars.reason })).data,
    onSuccess: () => {
      push({ tone: 'info', title: 'Request rejected', description: 'The applicant has been emailed.' });
      setRejecting(null);
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => showError(e, 'The request could not be rejected.'),
  });

  const invite = useMutation({
    mutationFn: async (vars: { email: string; role: string; departmentId?: string }) =>
      (await registrationsApi.invite(vars)).data,
    onSuccess: (data) => {
      push({ tone: 'success', title: 'Invitation sent', description: data.message });
      setInviteOpen(false);
    },
    onError: (e) => showError(e, 'The invitation could not be sent.'),
  });

  if (!can(PERMISSIONS.USER_APPROVE)) {
    return <EmptyState title="Not available" description="You do not have permission to review account requests." />;
  }

  /** Only a system administrator may grant an administrator role. */
  const grantableRoles = ROLES.filter(
    (r) => user?.role === 'SUPER_ADMIN' || (r !== 'SUPER_ADMIN' && r !== 'HOSPITAL_ADMIN'),
  );

  return (
    <div className="space-y-space-6">
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <div>
          <h2 className="text-headline-md text-on-surface font-semibold">Account requests</h2>
          <p className="text-body-sm text-on-surface-variant mt-1">
            People who registered and confirmed their email. Nobody has access until you grant it.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} icon={<Send className="h-4 w-4" aria-hidden />}>
          Invite a colleague
        </Button>
      </div>

      {queue.isLoading ? <LoadingBlock /> : null}
      {queue.isError ? <ErrorState onRetry={() => queue.refetch()} /> : null}

      {queue.data && queue.data.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="No account requests need review. New registrations appear here once the applicant confirms their email address."
        />
      ) : null}

      <div className="space-y-space-3">
        {queue.data?.map((account) => {
          const verified = Boolean(account.emailVerifiedAt);
          return (
            <Card key={account.id} className="p-space-5">
              <div className="flex flex-wrap items-start justify-between gap-space-4">
                <div className="flex items-start gap-space-4 min-w-0">
                  <Avatar name={account.fullName} />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-space-2">
                      <span className="text-body-lg text-on-surface font-semibold">{account.fullName}</span>
                      {verified
                        ? <Badge tone="success">Email confirmed</Badge>
                        : <Badge tone="attention">Awaiting confirmation</Badge>}
                    </div>
                    <p className="text-body-sm text-on-surface-variant flex items-center gap-space-2">
                      <Mail className="h-3.5 w-3.5" aria-hidden /> {account.email}
                      {account.phone ? <span>· {account.phone}</span> : null}
                    </p>
                    <p className="text-body-sm text-on-surface-variant flex items-center gap-space-2">
                      <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
                      Asked for{' '}
                      <span className="font-medium text-on-surface">
                        {account.requestedRole ? ROLE_LABELS[account.requestedRole as Role] ?? account.requestedRole : 'no specific role'}
                      </span>
                      {account.requestedDepartmentName ? <span>in {account.requestedDepartmentName}</span> : null}
                    </p>
                    <p className="text-label-md text-outline flex items-center gap-space-2">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      Registered {timeAgo(account.createdAt)} · {formatDateTime(account.createdAt)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-space-2 shrink-0">
                  <Button
                    variant="ghost"
                    onClick={() => setRejecting(account)}
                    icon={<UserX className="h-4 w-4" aria-hidden />}
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={() => setApproving(account)}
                    disabled={!verified}
                    icon={<UserCheck className="h-4 w-4" aria-hidden />}
                  >
                    Review &amp; approve
                  </Button>
                </div>
              </div>

              {account.registrationNote ? (
                <div className="mt-space-4 rounded-lg bg-surface-container-low border border-outline-variant/60 p-space-3">
                  <p className="text-label-md text-outline uppercase tracking-wide mb-1">
                    What they said about themselves
                  </p>
                  <p className="text-body-sm text-on-surface whitespace-pre-wrap">{account.registrationNote}</p>
                </div>
              ) : null}

              {!verified ? (
                <p className="mt-space-3 text-body-sm text-on-surface-variant">
                  They have not confirmed their email address yet, so approval is disabled. You can
                  still reject the request.
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>

      {approving ? (
        <ApproveDialog
          account={approving}
          roles={grantableRoles}
          departments={departments.data ?? []}
          pending={approve.isPending}
          onCancel={() => setApproving(null)}
          onConfirm={(values) => approve.mutate({ id: approving.id, ...values })}
        />
      ) : null}

      {rejecting ? (
        <RejectDialog
          account={rejecting}
          pending={reject.isPending}
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => reject.mutate({ id: rejecting.id, reason })}
        />
      ) : null}

      {inviteOpen ? (
        <InviteDialog
          roles={grantableRoles}
          departments={departments.data ?? []}
          pending={invite.isPending}
          onCancel={() => setInviteOpen(false)}
          onConfirm={(values) => invite.mutate(values)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ dialogs */

type Dept = { id: string; name: string };

function ApproveDialog({
  account, roles, departments, pending, onCancel, onConfirm,
}: {
  account: PendingAccountDto;
  roles: Role[];
  departments: Dept[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (v: {
    role: string; departmentId?: string; designation?: string;
    specialization?: string; registrationNumber?: string; acceptsReferrals?: boolean;
  }) => void;
}) {
  // Deliberately blank rather than pre-filled with what they asked for. An
  // approval should be a decision, not a confirmation of someone else's claim.
  const [role, setRole] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState(account.requestedDepartmentId ?? '');
  const [designation, setDesignation] = React.useState('');
  const [specialization, setSpecialization] = React.useState('');
  const [registrationNumber, setRegistrationNumber] = React.useState('');
  const [acceptsReferrals, setAcceptsReferrals] = React.useState(false);

  return (
    <Modal open onClose={onCancel} title={`Approve ${account.fullName}`}>
      <div className="space-y-space-4">
        <p className="text-body-sm text-on-surface-variant">
          {account.email} asked to be{' '}
          <span className="font-medium text-on-surface">
            {account.requestedRole ? ROLE_LABELS[account.requestedRole as Role] ?? account.requestedRole : 'unspecified'}
          </span>. Choose what they actually get — the request carries no authority.
        </p>

        <Field label="Grant this role" htmlFor="role" required>
          <Select id="role" value={role} onChange={(e) => setRole(e.target.value)} required>
            <option value="">Choose a role</option>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>

        <Field label="Department" htmlFor="departmentId">
          <Select id="departmentId" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>

        <div className="grid sm:grid-cols-2 gap-space-4">
          <Field label="Designation" htmlFor="designation">
            <Input id="designation" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Consultant Physician" />
          </Field>
          <Field label="Specialisation" htmlFor="specialization">
            <Input id="specialization" value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="Internal Medicine" />
          </Field>
        </div>

        <Field label="Professional registration number" htmlFor="registrationNumber" hint="Verify this against the register before approving.">
          <Input id="registrationNumber" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
        </Field>

        <label className="flex items-center gap-space-3 text-body-sm text-on-surface">
          <input
            type="checkbox"
            checked={acceptsReferrals}
            onChange={(e) => setAcceptsReferrals(e.target.checked)}
            className="h-4 w-4 rounded border-outline"
          />
          Accepts specialist referrals
        </label>

        <div className="flex justify-end gap-space-3 pt-space-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            loading={pending}
            disabled={!role}
            onClick={() => onConfirm({
              role,
              departmentId: departmentId || undefined,
              designation: designation || undefined,
              specialization: specialization || undefined,
              registrationNumber: registrationNumber || undefined,
              acceptsReferrals,
            })}
          >
            Approve and grant access
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RejectDialog({
  account, pending, onCancel, onConfirm,
}: { account: PendingAccountDto; pending: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = React.useState('');
  return (
    <Modal open onClose={onCancel} title={`Reject ${account.fullName}`}>
      <div className="space-y-space-4">
        <p className="text-body-sm text-on-surface-variant">
          The applicant is emailed this reason. They will not be able to sign in, and cannot
          recover the account through a password reset.
        </p>
        <Field label="Reason" htmlFor="reason" required>
          <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Could not verify professional registration." required />
        </Field>
        <div className="flex justify-end gap-space-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" loading={pending} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason)}>
            Reject request
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function InviteDialog({
  roles, departments, pending, onCancel, onConfirm,
}: {
  roles: Role[]; departments: Dept[]; pending: boolean;
  onCancel: () => void;
  onConfirm: (v: { email: string; role: string; departmentId?: string }) => void;
}) {
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');

  return (
    <Modal open onClose={onCancel} title="Invite a colleague">
      <div className="space-y-space-4">
        <p className="text-body-sm text-on-surface-variant">
          They receive a link that sets their password and activates the account with the role you
          choose here. No approval step, because you are the approval — and the role travels in the
          invitation, so they cannot change it.
        </p>
        <Field label="Work email address" htmlFor="inviteEmail" required>
          <Input id="inviteEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@hospital.org" required />
        </Field>
        <Field label="Role" htmlFor="inviteRole" required>
          <Select id="inviteRole" value={role} onChange={(e) => setRole(e.target.value)} required>
            <option value="">Choose a role</option>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        <Field label="Department" htmlFor="inviteDept">
          <Select id="inviteDept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-space-3">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button loading={pending} disabled={!email || !role} onClick={() => onConfirm({ email, role, departmentId: departmentId || undefined })}>
            Send invitation
          </Button>
        </div>
      </div>
    </Modal>
  );
}
