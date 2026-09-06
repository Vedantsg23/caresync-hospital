import '@/server/only';
import { Pool, type PoolConfig } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

declare global {
  var __caresyncPool: Pool | undefined;
}

function buildPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const config: PoolConfig = {
    connectionString,
    // Serverless-friendly: small pool, short idle, fail fast.
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    allowExitOnIdle: true,
  };

  // Managed Postgres (Supabase / Neon / Vercel) terminates TLS with certs that
  // are not in the default CA bundle for direct connections.
  const needsSsl = /supabase|neon|vercel|render|railway|amazonaws|sslmode=require/i.test(connectionString);
  if (needsSsl && !/localhost|127\.0\.0\.1/.test(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool(config);
  pool.on('error', (err) => {
    console.error('[db] idle client error', err.message);
  });
  return pool;
}

export const pool: Pool = global.__caresyncPool ?? buildPool();
if (process.env.NODE_ENV !== 'production') global.__caresyncPool = pool;

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema, logger: false });
export type Db = typeof db;
export { schema };
