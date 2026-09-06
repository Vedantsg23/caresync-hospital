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

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the values.`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === 'production';
