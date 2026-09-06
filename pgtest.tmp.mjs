import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query('select version(), current_database(), current_user');
console.log(r.rows[0]);
await c.end();
