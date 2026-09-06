'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, Search, MessageSquare, LogOut, Menu, User, Loader2, Wifi, WifiOff, CheckCheck,
} from 'lucide-react';
import { authApi, notificationsApi, searchApi } from '@/lib/api/endpoints';
import { useAuth, useErrorToast } from '@/components/providers';
import { useRealtime } from '@/hooks/use-realtime';
import { Badge, Button, EmptyState } from '@/components/ui';
import { cn, timeAgo, initials } from '@/lib/utils';
import { ROLE_LABELS } from '@/types/rbac';

export function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const showError = useErrorToast();
  const realtime = useRealtime();

  const [notifOpen, setNotifOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLDivElement>(null);
  const notifRef = React.useRef<HTMLDivElement>(null);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 20 }),
    refetchInterval: 60_000,
  });

  const unreadCount = (notifications.data?.meta?.unreadCount as number | undefined) ?? realtime.unreadCount;

  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => showError(e),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => { router.replace('/login'); router.refresh(); },
    onError: (e) => showError(e, 'Could not sign out.'),
  });

  const debounced = useDebounce(query, 250);
  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi.global(debounced),
    enabled: debounced.trim().length >= 2,
  });

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const results = search.data?.data.patients ?? [];

  return (
    <header className="fixed top-0 left-0 lg:left-64 right-0 h-16 bg-surface/85 backdrop-blur-xl
                       shadow-[0_1px_8px_rgba(19,27,46,0.04)] z-40 flex items-center justify-between
                       gap-space-4 px-space-4 sm:px-space-8">
      <div className="flex items-center gap-space-3 flex-1 min-w-0">
        <button onClick={onOpenNav} className="lg:hidden p-2 rounded-xl hover:bg-surface-container-high text-on-surface-variant" aria-label="Open navigation">
          <Menu className="h-5 w-5" aria-hidden />
        </button>

        <div className="relative w-full max-w-md" ref={searchRef}>
          <Search className="absolute left-space-3 top-1/2 -translate-y-1/2 h-4 w-4 text-outline" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search patients, MRN, admission number…"
            aria-label="Search patients"
            className="w-full bg-surface-container-low pl-10 pr-space-4 py-2 rounded-xl text-body-sm text-on-surface
                       placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-secondary"
          />

          {searchOpen && debounced.trim().length >= 2 ? (
            <div className="absolute top-full mt-2 w-full bg-surface-container-lowest rounded-xl shadow-overlay border border-outline-variant/60 overflow-hidden z-50">
              {search.isLoading ? (
                <div className="flex items-center gap-space-2 px-space-4 py-space-4 text-body-sm text-on-surface-variant">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Searching…
                </div>
              ) : results.length === 0 ? (
                <p className="px-space-4 py-space-4 text-body-sm text-on-surface-variant">
                  No patients found in the records you have access to.
                </p>
              ) : (
                <ul className="max-h-80 overflow-y-auto cs-scroll py-1">
                  {results.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/patients/${p.id}`}
                        onClick={() => { setSearchOpen(false); setQuery(''); }}
                        className="flex items-center justify-between gap-space-3 px-space-4 py-space-2.5 hover:bg-surface-container-low"
                      >
                        <span className="min-w-0">
                          <span className="block text-body-sm font-semibold text-on-surface truncate">
                            {p.firstName} {p.lastName}
                          </span>
                          <span className="block text-label-md text-outline font-mono">{p.patientNumber}</span>
                        </span>
                        {p.status !== 'STABLE' ? (
                          <Badge tone={p.status === 'CRITICAL' ? 'critical' : 'attention'}>
                            {p.status === 'CRITICAL' ? 'Critical' : 'Attention'}
                          </Badge>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-space-2 sm:gap-space-3 shrink-0">
        {user ? (
          <div className="hidden xl:flex items-center gap-space-2 bg-surface-container-low px-space-3 py-1.5 rounded-xl">
            <span
              className={cn('w-1.5 h-1.5 rounded-full', realtime.connected ? 'bg-tertiary-fixed-dim animate-pulse' : 'bg-outline-variant')}
              aria-hidden
            />
            <span className="text-label-md text-on-surface font-medium">
              {user.departmentName ?? ROLE_LABELS[user.role]} · {user.fullName}
            </span>
            {realtime.connected
              ? <Wifi className="h-3.5 w-3.5 text-on-tertiary-fixed-variant" aria-label="Live updates connected" />
              : <WifiOff className="h-3.5 w-3.5 text-outline" aria-label="Live updates reconnecting" />}
          </div>
        ) : null}

        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative p-2 rounded-xl hover:bg-surface-container-high text-on-surface-variant transition-colors"
            aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
          >
            <Bell className="h-5 w-5" aria-hidden />
            {unreadCount > 0 ? (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-error text-on-error
                               text-[10px] font-bold flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </button>

          {notifOpen ? (
            <div className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-2rem))] bg-surface-container-lowest
                            rounded-xl shadow-overlay border border-outline-variant/60 overflow-hidden z-50">
              <div className="flex items-center justify-between px-space-4 py-space-3 border-b border-outline-variant/50">
                <span className="text-body-sm font-semibold text-on-surface">Notifications</span>
                {unreadCount > 0 ? (
                  <button
                    onClick={() => markAllRead.mutate()}
                    className="text-label-md text-secondary font-semibold hover:underline flex items-center gap-1"
                  >
                    <CheckCheck className="h-3.5 w-3.5" aria-hidden /> Mark all read
                  </button>
                ) : null}
              </div>

              <div className="max-h-96 overflow-y-auto cs-scroll">
                {notifications.isLoading ? (
                  <div className="px-space-4 py-space-6 text-body-sm text-on-surface-variant">Loading…</div>
                ) : (notifications.data?.data.length ?? 0) === 0 ? (
                  <EmptyState title="You are up to date" description="New referrals, results and alerts will appear here." className="py-space-8" />
                ) : (
                  <ul className="divide-y divide-outline-variant/40">
                    {notifications.data!.data.map((n) => (
                      <li key={n.id}>
                        <Link
                          href={n.link ?? '#'}
                          onClick={() => { if (!n.read) markRead.mutate(n.id); setNotifOpen(false); }}
                          className={cn('block px-space-4 py-space-3 hover:bg-surface-container-low transition-colors',
                            !n.read && 'bg-secondary-fixed/20')}
                        >
                          <div className="flex items-start gap-space-2">
                            {n.severity === 'CRITICAL' ? (
                              <span className="mt-1.5 w-2 h-2 rounded-full bg-error shrink-0" aria-hidden />
                            ) : !n.read ? (
                              <span className="mt-1.5 w-2 h-2 rounded-full bg-secondary shrink-0" aria-hidden />
                            ) : (
                              <span className="mt-1.5 w-2 h-2 shrink-0" aria-hidden />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-body-sm font-semibold text-on-surface">{n.title}</p>
                              <p className="text-body-sm text-on-surface-variant mt-0.5 line-clamp-2">{n.message}</p>
                              <p className="text-label-md text-outline mt-1">{timeAgo(n.createdAt)}</p>
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <Link href="/messages" className="p-2 rounded-xl hover:bg-surface-container-high text-on-surface-variant transition-colors" aria-label="Messages">
          <MessageSquare className="h-5 w-5" aria-hidden />
        </Link>

        <div className="flex items-center gap-space-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-on-primary text-label-md font-bold" aria-hidden>
            {user ? initials(user.fullName) : <User className="h-4 w-4" />}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout.mutate()}
            loading={logout.isPending}
            icon={<LogOut className="h-4 w-4" />}
            aria-label="Sign out"
          >
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
