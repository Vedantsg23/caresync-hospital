'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { ToastViewport, type Toast } from '@/components/ui';
import type { AuthUserDto } from '@/types/api';
import type { Permission } from '@/types/rbac';

/* ---------------------------------------------------------------- toast -- */

type ToastInput = { title: string; description?: string; tone?: Toast['tone'] };
const ToastContext = React.createContext<{ push: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <Providers>');
  return ctx;
}

/** Turns any thrown value into a toast a clinician can act on. */
export function useErrorToast() {
  const { push } = useToast();
  return React.useCallback((err: unknown, fallback = 'The action could not be completed.') => {
    if (err instanceof ApiError) {
      const detail = err.issues.length ? err.issues.map((i) => i.message).join(' ') : undefined;
      push({ title: err.message || fallback, description: detail, tone: 'error' });
    } else {
      push({ title: fallback, tone: 'error' });
    }
  }, [push]);
}

/* ----------------------------------------------------------------- auth -- */

type AuthContextValue = {
  user: AuthUserDto | null;
  can: (permission: Permission) => boolean;
  isRole: (...roles: string[]) => boolean;
};

const AuthContext = React.createContext<AuthContextValue>({
  user: null,
  can: () => false,
  isRole: () => false,
});

export function useAuth() {
  return React.useContext(AuthContext);
}

export function AuthProvider({ user, children }: { user: AuthUserDto | null; children: React.ReactNode }) {
  const value = React.useMemo<AuthContextValue>(() => ({
    user,
    can: (permission) => !!user && user.permissions.includes(permission),
    isRole: (...roles) => !!user && roles.includes(user.role),
  }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/* ------------------------------------------------------------ providers -- */

export function Providers({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const push = React.useCallback((t: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-3), { id, tone: t.tone ?? 'info', title: t.title, description: t.description }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.tone === 'error' ? 8000 : 5000);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const [queryClient] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Never retry an authorisation failure - it will not become allowed.
          if (error instanceof ApiError && [401, 403, 404, 422].includes(error.status)) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  }));

  const toastValue = React.useMemo(() => ({ push }), [push]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastContext.Provider value={toastValue}>
        {children}
        <ToastViewport toasts={toasts} onDismiss={dismiss} />
      </ToastContext.Provider>
    </QueryClientProvider>
  );
}
