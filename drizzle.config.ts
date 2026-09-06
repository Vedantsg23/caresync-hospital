import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/server/db/schema.ts',
  out: './database/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL as string },
  strict: true,
  verbose: true,
} satisfies Config;
