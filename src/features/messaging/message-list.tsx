'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Plus, Users } from 'lucide-react';
import { messagesApi, staffApi, patientsApi } from '@/lib/api/endpoints';
import { useToast, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal,
  Select, Textarea,
} from '@/components/ui';
import { cn, timeAgo, titleCase } from '@/lib/utils';

export function MessageList() {
  const [composeOpen, setComposeOpen] = React.useState(false);
  useRealtime();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => messagesApi.list(),
    refetchInterval: 30_000,
  });

  const conversations = data?.data ?? [];

  return (
    <div className="space-y-space-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-4">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold tracking-tight">Messages</h1>
          <p className="text-body-md text-on-surface-variant mt-1">
            Directed clinical communication between named staff. A conversation about a patient requires access to that patient.
          </p>
        </div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setComposeOpen(true)}>New conversation</Button>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? <LoadingBlock rows={4} />
          : isError ? <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
          : conversations.length === 0 ? (
            <EmptyState icon={<MessageSquare className="h-8 w-8" />} title="No conversations"
              description="Start one to ask a colleague about a patient. Messages are private to their participants."
              action={<Button size="sm" onClick={() => setComposeOpen(true)}>Start a conversation</Button>} />
          ) : (
            <ul className="divide-y divide-outline-variant/30">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/messages/${c.id}`}
                    className={cn('flex items-start justify-between gap-space-4 px-space-6 py-space-4 hover:bg-surface-container-low/60 transition-colors',
                      c.unreadCount > 0 && 'bg-secondary-fixed/20')}>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-space-2 flex-wrap">
                        <span className="text-body-md font-semibold text-on-surface">{c.subject}</span>
                        {c.unreadCount > 0 ? <Badge tone="info">{c.unreadCount} new</Badge> : null}
                      </div>
                      {c.patientName ? (
                        <p className="text-label-md text-outline">
                          About {c.patientName} · <span className="font-mono">{c.patientNumber}</span>
                        </p>
                      ) : null}
                      {c.lastMessage ? (
                        <p className="text-body-sm text-on-surface-variant line-clamp-1">{c.lastMessage}</p>
                      ) : null}
                      <p className="text-label-md text-outline flex items-center gap-1.5">
                        <Users className="h-3 w-3" aria-hidden />
                        {c.participantCount} participants · {c.messageCount} messages
                      </p>
                    </div>
                    <span className="text-label-md text-outline shrink-0">{timeAgo(c.lastMessageAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
      </Card>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
    </div>
  );
}

function ComposeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const showError = useErrorToast();
  const [selected, setSelected] = React.useState<string[]>([]);

  const directory = useQuery({ queryKey: ['staff-directory'], queryFn: () => staffApi.directory(), enabled: open, staleTime: 300_000 });
  const patients = useQuery({ queryKey: ['patients', 'for-message'], queryFn: () => patientsApi.search({ pageSize: 50 }), enabled: open });

  const mutation = useMutation({
    mutationFn: (payload: { subject: string; participantIds: string[]; patientId?: string; firstMessage?: string }) =>
      messagesApi.create(payload),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      push({ title: 'Conversation started', tone: 'success' });
      setSelected([]);
      onClose();
      router.push(`/messages/${data.id}`);
    },
    onError: (e) => showError(e, 'The conversation could not be created.'),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const patientId = String(form.get('patientId') ?? '');
    mutation.mutate({
      subject: String(form.get('subject')).trim(),
      participantIds: selected,
      patientId: patientId || undefined,
      firstMessage: String(form.get('firstMessage') ?? '').trim() || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New conversation"
      description="Select the colleagues who should see this. Attaching a patient gives the thread clinical context."
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="compose-form" loading={mutation.isPending} disabled={selected.length === 0}>
            Start conversation
          </Button>
        </>
      }
    >
      <form id="compose-form" onSubmit={submit} className="space-y-space-4" noValidate>
        <Field label="Subject" htmlFor="subject" required>
          <Input id="subject" name="subject" required placeholder="Rahul Mehta - ECG and angiogram review" autoFocus />
        </Field>

        <Field label="Patient context" htmlFor="patientId" hint="Optional. Only patients you have access to are listed.">
          <Select id="patientId" name="patientId" defaultValue="">
            <option value="">No patient attached</option>
            {(patients.data?.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.fullName} — {p.patientNumber}</option>
            ))}
          </Select>
        </Field>

        <Field label="Participants" required hint={`${selected.length} selected`}>
          <div className="max-h-56 overflow-y-auto cs-scroll border border-outline-variant rounded-lg divide-y divide-outline-variant/40">
            {(directory.data?.data ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-space-3 px-space-3 py-space-2 hover:bg-surface-container-low cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={(e) => setSelected((prev) => e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id))}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-secondary"
                />
                <span className="min-w-0">
                  <span className="block text-body-sm font-medium text-on-surface truncate">{s.fullName}</span>
                  <span className="block text-label-md text-outline truncate">
                    {s.designation ?? titleCase(s.role)}{s.departmentName ? ` · ${s.departmentName}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="First message" htmlFor="firstMessage">
          <Textarea id="firstMessage" name="firstMessage" rows={3} placeholder="Could you review the latest ECG for this patient?" />
        </Field>
      </form>
    </Modal>
  );
}
