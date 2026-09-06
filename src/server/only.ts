/**
 * Server-only guard.
 *
 * The `server-only` npm package throws when loaded outside the Next.js
 * bundler, which breaks migration/seed scripts and the test runner. This does
 * the same job - a hard failure if server code is ever pulled into a client
 * bundle - while remaining importable from plain Node.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'A server module was imported from client code. Server modules under src/server/** ' +
    'hold database access and secrets and must never reach the browser.',
  );
}

export {};
