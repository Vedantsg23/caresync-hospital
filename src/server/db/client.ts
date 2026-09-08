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

  /**
   * JIT off, deliberately, and measured.
   *
   * PostgreSQL turns on LLVM compilation for any plan whose *estimated* cost
   * clears jit_above_cost (100000). Estimates on a table of 50,000 patients
   * clear that easily, and once past jit_optimize_above_cost the planner also
   * runs the optimiser. On the dashboard query this was captured as:
   *
   *   Timing: Generation 3.9 ms, Inlining 17.8 ms, Optimization 311.9 ms,
   *           Emission 183.1 ms, Total 516.7 ms
   *
   * out of 614ms total — the query itself took under 100ms. JIT pays for
   * itself on an analytical query that scans for seconds; it is a straight
   * loss on an OLTP request that returns twenty rows, and here it was the
   * single largest component of the slowest endpoint in the application.
   *
   * Set per connection rather than per deployment because most managed
   * Postgres (Neon, Supabase, RDS) ships with jit on and does not always let
   * you change it, and because the reason belongs next to the measurement.
   */
  pool.on('connect', (client) => {
    client.query('SET jit = off').catch(() => {
      // A provider that refuses the SET is not a reason to fail a request.
    });
  });

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
