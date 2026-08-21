import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting',
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
