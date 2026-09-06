'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/providers';
import type { NotificationDto } from '@/types/api';

type RealtimeState = { connected: boolean; unreadCount: number; lastEventAt: Date | null };

/**
 * Subscribes to the server-sent event stream.
 *
 * On a new notification it both surfaces a toast and invalidates the affected
 * React Query caches, so a referral that arrives while the specialist is
 * looking at their inbox appears without a refresh. EventSource reconnects on
 * its own when the server closes the window, so there is no manual retry loop.
 */
export function useRealtime(options: { patientId?: string; enabled?: boolean } = {}): RealtimeState {
  const { patientId, enabled = true } = options;
  const queryClient = useQueryClient();
  const { push } = useToast();

  const [state, setState] = React.useState<RealtimeState>({ connected: false, unreadCount: 0, lastEventAt: null });
  const pushRef = React.useRef(push);
  pushRef.current = push;

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const url = patientId
      ? `/api/realtime/stream?patientId=${encodeURIComponent(patientId)}`
      : '/api/realtime/stream';

    const source = new EventSource(url, { withCredentials: true });

    const onConnected = (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { unreadCount: number };
      setState((s) => ({ ...s, connected: true, unreadCount: data.unreadCount }));
    };

    const onNotification = (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { items: NotificationDto[]; unreadCount: number };
      setState((s) => ({ ...s, unreadCount: data.unreadCount, lastEventAt: new Date() }));

      data.items.forEach((n) => {
        pushRef.current({
          title: n.title,
          description: n.message,
          tone: n.severity === 'CRITICAL' ? 'error' : 'info',
        });
      });

      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (patientId) {
        queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      }
    };

    const onPatientUpdate = () => {
      setState((s) => ({ ...s, lastEventAt: new Date() }));
      if (patientId) queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    };

    const onError = () => setState((s) => ({ ...s, connected: false }));

    source.addEventListener('connected', onConnected as EventListener);
    source.addEventListener('notification', onNotification as EventListener);
    source.addEventListener('patient-update', onPatientUpdate as EventListener);
    source.addEventListener('error', onError);

    return () => {
      source.removeEventListener('connected', onConnected as EventListener);
      source.removeEventListener('notification', onNotification as EventListener);
      source.removeEventListener('patient-update', onPatientUpdate as EventListener);
      source.removeEventListener('error', onError);
      source.close();
    };
  }, [enabled, patientId, queryClient]);

  return state;
}
