import { z } from 'zod';

/**
 * Fail-fast environment validation.
 * Secrets are read on the server only — nothing here is bundled into the
 * client except values explicitly prefixed with NEXT_PUBLIC_.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  SESSION_MAX_AGE: z.coerce.number().int().positive().default(28800),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_NAME: z.string().default('CareSync Hospital'),
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  SEED_DEMO_PASSWORD: z.string().min(8).default('CareSync#2026'),
  SEED_FORCE: z.string().optional(),
  AI_PROVIDER: z.enum(['heuristic', 'anthropic', 'openai']).default('heuristic'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  STORAGE_DRIVER: z.enum(['database', 'local', 'supabase']).default('database'),
  STORAGE_MAX_FILE_MB: z.coerce.number().positive().default(10),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('caresync-documents'),
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof schema>;

/**
 * Thrown when the process is misconfigured, carrying the *names* of the
 * offending variables — never their values.
 *
 * This distinction is the whole point of the class. A misconfigured deployment
 * previously surfaced as "An unexpected error occurred", identical to a genuine
 * crash, because the generic handler could not tell the two apart: sign-in
 * failed with a 500 for every password, and nothing said why. The names are
 * already public in `.env.example`; the values are the secret. So the names
 * travel to the operator and the values never leave the process.
 */
export class EnvConfigError extends Error {
  readonly variables: string[];

  constructor(variables: string[], detail: string) {
    super(`Invalid environment configuration:\n${detail}`);
    this.name = 'EnvConfigError';
    this.variables = variables;
  }
}

let cached: Env | null = null;

/**
 * An environment variable set to the empty string is unset.
 *
 * Every system that hands us an environment does this: a shell `export FOO=`,
 * a Dockerfile `ENV FOO=`, a CI secret that resolved to nothing, and — the case
 * that bit us — a Vercel dashboard row saved with a blank value. Zod's
 * `.default()` only fires on `undefined`, so without this an empty string is
 * "provided", the default never applies, and a variable the operator never
 * meant to set fails validation and takes the whole deployment down.
 *
 * Blanking a variable in a dashboard has to mean the same thing as deleting the
 * row, because to the person doing it those are the same action.
 */
function definedEntries(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(definedEntries(process.env));
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '(root)')))];
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
      + '\n\nCopy .env.example to .env and fill in the values. On Vercel, set them in\n'
      + 'Settings -> Environment Variables and then REDEPLOY: variables are applied at\n'
      + 'build time, so adding one changes nothing until a new build runs.';
    throw new EnvConfigError(variables, detail);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Non-throwing form, for the health endpoint. Reports whether the process is
 * configured and which variables are wrong, without ever reading a value back.
 */
export function envStatus(): { ok: true } | { ok: false; invalid: string[] } {
  try {
    getEnv();
    return { ok: true };
  } catch (err) {
    if (err instanceof EnvConfigError) return { ok: false, invalid: err.variables };
    return { ok: false, invalid: ['(unknown)'] };
  }
}

export const isProduction = () => process.env.NODE_ENV === 'production';
