'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, ExternalLink } from 'lucide-react';
import { messagesApi } from '@/lib/api/endpoints';
import { useAuth, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import { Avatar, Badge, Button, Card, ErrorState, LoadingBlock, Textarea } from '@/components/ui';
import { cn, formatDateTime, titleCase } from '@/lib/utils';

export function ConversationView({ conversationId }: { conversationId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const [body, setBody] = React.useState('');
  const endRef = React.useRef<HTMLDivElement>(null);
  useRealtime();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => messagesApi.get(conversationId),
    refetchInterval: 15_000,
  });

  const send = useMutation({
    mutationFn: (text: string) => messagesApi.send(conversationId, text),
    onSuccess: () => {
      setBody('');
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (e) => showError(e, 'The message could not be sent.'),
  });

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.data.messages.length]);

  if (isLoading) return <Card><LoadingBlock rows={5} /></Card>;
  if (isError || !data) {
    return <ErrorState title="Conversation unavailable"
      message={(error as Error)?.message ?? 'You are not a participant in this conversation.'} onRetry={() => refetch()} />;
  }

  const c = data.data;

  return (
    <div className="space-y-space-4 max-w-4xl">
      <Link href="/messages" className="inline-flex items-center gap-1.5 text-label-md text-outline hover:text-on-surface font-medium">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to messages
      </Link>

      <Card className="flex flex-col h-[calc(100vh-220px)] min-h-[480px]">
        <header className="px-space-6 py-space-4 border-b border-outline-variant/40 flex items-start justify-between gap-space-4">
          <div className="min-w-0">
            <h1 className="text-headline-sm text-on-surface font-semibold">{c.subject}</h1>
            <p className="text-label-md text-outline mt-0.5">
              {c.participants.map((p) => p.name).join(', ')}
            </p>
          </div>
          {c.patientId ? (
            <Link href={`/patients/${c.patientId}`} className="shrink-0">
              <Button variant="secondary" size="sm" icon={<ExternalLink className="h-4 w-4" />}>
                {c.patientName}
              </Button>
            </Link>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto cs-scroll p-space-6 space-y-space-4">
          {c.messages.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant text-center py-space-8">
              No messages yet. Write the first one below.
            </p>
          ) : (
            c.messages.map((m) => {
              const mine = m.senderId === user?.id;
              return (
                <div key={m.id} className={cn('flex items-start gap-space-3', mine && 'flex-row-reverse')}>
                  <Avatar name={m.senderName} size="sm" tone={mine ? 'info' : 'neutral'} />
                  <div className={cn('max-w-[75%] min-w-0', mine && 'text-right')}>
                    <div className={cn('flex items-center gap-space-2 mb-1', mine && 'flex-row-reverse')}>
                      <span className="text-label-md font-semibold text-on-surface">{mine ? 'You' : m.senderName}</span>
                      <Badge tone="muted">{titleCase(m.senderRole)}</Badge>
                    </div>
                    <div className={cn('inline-block px-space-4 py-space-3 rounded-xl text-body-sm whitespace-pre-wrap text-left',
                      mine ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface')}>
                      {m.body}
                    </div>
                    <p className="text-label-sm text-outline mt-1">{formatDateTime(m.createdAt)}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(body.trim()); }}
          className="p-space-4 border-t border-outline-variant/40 flex items-end gap-space-3"
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
                e.preventDefault();
                send.mutate(body.trim());
              }
            }}
            rows={2}
            placeholder="Write a message. Ctrl or Cmd + Enter to send."
            aria-label="Message"
            className="min-h-0 flex-1"
          />
          <Button type="submit" loading={send.isPending} disabled={!body.trim()} icon={<Send className="h-4 w-4" />}>
            Send
          </Button>
        </form>
      </Card>
    </div>
  );
}
