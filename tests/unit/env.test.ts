import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * A misconfigured deployment must say so.
 *
 * This exists because a missing AUTH_SECRET on Vercel surfaced as
 * "An unexpected error occurred" on sign-in — a generic 500, identical to a
 * real crash, for every password anyone typed. The names of the offending
 * variables are safe to report (they are listed in `.env.example`); the values
 * are the secret. These tests pin both halves of that.
 */
describe('environment validation', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  /** getEnv() memoises, so each case needs a fresh module instance. */
  const freshEnv = async () => {
    vi.resetModules();
    return import('@/lib/env');
  };

  it('accepts the test configuration', async () => {
    const { envStatus } = await freshEnv();
    expect(envStatus()).toEqual({ ok: true });
  });

  it('names a missing variable instead of throwing something generic', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    const { getEnv, envStatus, EnvConfigError } = await freshEnv();

    expect(envStatus()).toEqual({ ok: false, invalid: ['AUTH_SECRET'] });

    try {
      getEnv();
      expect.unreachable('getEnv must throw when the configuration is invalid');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvConfigError);
      expect((err as InstanceType<typeof EnvConfigError>).variables).toEqual(['AUTH_SECRET']);
    }
  });

  it('names a variable that is present but too weak to use', async () => {
    vi.stubEnv('AUTH_SECRET', 'short');
    const { envStatus } = await freshEnv();
    const status = envStatus();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.invalid).toContain('AUTH_SECRET');
  });

  it('reports every offending variable, not just the first', async () => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('DATABASE_URL', '');
    const { envStatus } = await freshEnv();
    const status = envStatus();
    expect(status.ok).toBe(false);
    expect(status.ok === false && status.invalid.sort()).toEqual(['AUTH_SECRET', 'DATABASE_URL']);
  });

  it('never puts a secret value in the error', async () => {
    const secret = 'a-real-looking-secret-that-must-not-leak-0123456789';
    vi.stubEnv('AUTH_SECRET', secret);
    vi.stubEnv('AI_PROVIDER', 'not-a-valid-provider');
    const { getEnv } = await freshEnv();

    try {
      getEnv();
      expect.unreachable('invalid AI_PROVIDER must be rejected');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('AI_PROVIDER');
      expect(message, 'the message must never carry a value').not.toContain(secret);
    }
  });
});
