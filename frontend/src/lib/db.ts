import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting',
  max: 20,                          // max connections in pool
  idleTimeoutMillis: 30_000,        // close idle connections after 30s
  connectionTimeoutMillis: 5_000,   // fail if can't connect in 5s
});

// Log unexpected errors on idle clients to prevent silent connection drops
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

export const query = (text: string, params?: unknown[]) => pool.query(text, params);
export default pool;
