/* DANGER: drops and recreates the public schema. Development only. */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_RESET !== 'yes-i-am-sure') {
    throw new Error('Refusing to reset a production database.');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const ssl = /supabase|neon|vercel|render|railway|amazonaws/i.test(url) && !/localhost|127\.0\.0\.1/.test(url)
    ? { rejectUnauthorized: false }
    : undefined;
  const client = new Client({ connectionString: url, ssl });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  console.log('✔ schema reset');
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
