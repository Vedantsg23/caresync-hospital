'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[app] unhandled error', error); }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-surface p-space-8">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-space-4 w-12 h-12 rounded-full bg-error-container flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#93000a" strokeWidth="2" strokeLinecap="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          </svg>
        </div>
        <h1 className="text-headline-lg text-on-surface font-semibold">Something went wrong</h1>
        <p className="text-body-md text-on-surface-variant mt-space-2">
          The page could not be displayed. No clinical data has been changed.
        </p>
        {error.digest ? <p className="text-label-md text-outline mt-space-2 font-mono">Reference: {error.digest}</p> : null}
        <button
          onClick={reset}
          className="inline-flex items-center mt-space-6 px-space-4 py-2.5 rounded-xl bg-primary text-on-primary text-body-sm font-semibold"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
