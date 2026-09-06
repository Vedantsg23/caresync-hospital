import { config } from 'dotenv';

// Tests always run against the dedicated test database, never the dev one.
config({ path: '.env.test', override: true });

if (!process.env.DATABASE_URL?.includes('test')) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL does not point at a test database (${process.env.DATABASE_URL}).`,
  );
}

// NODE_ENV is typed as read-only by @types/node; assign through the record.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.SEED_FORCE = 'true';
