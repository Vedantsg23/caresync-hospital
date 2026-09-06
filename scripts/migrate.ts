/* Applies every SQL file in database/migrations in lexical order. */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'database', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const ssl = /supabase|neon|vercel|render|railway|amazonaws/i.test(url) && !/localhost|127\.0\.0\.1/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;

  const client = new Client({ connectionString: url, ssl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _caresync_migrations (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await client.query<{ name: string }>('SELECT name FROM _caresync_migrations')).rows.map((r) => r.name),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`  ▸ applying ${file} ... `);
    try {
      await client.query('BEGIN');
      // drizzle-kit separates independent statements with this marker
      for (const chunk of sql.split('--> statement-breakpoint')) {
        const trimmed = chunk.trim();
        if (trimmed) await client.query(trimmed);
      }
      await client.query('INSERT INTO _caresync_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('done');
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw err;
    }
  }

  console.log(count === 0 ? '✔ database already up to date' : `✔ applied ${count} migration(s)`);
  await client.end();
}

main().catch((err) => {
  console.error('✖ migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
