const { Pool } = require('pg');
const url = process.env.DATABASE_URL || '';
const pool = new Pool({ connectionString: url, ssl: /render\.com/.test(url) ? { rejectUnauthorized: false } : false });
async function init() {
  await pool.query(`
    create table if not exists follows(channel_id text primary key, title text, thumb text, uploads text, added_at timestamptz default now());
    create table if not exists queue(video_id text primary key, channel_id text, channel_title text, title text, data jsonb, status text default 'pending', created_at timestamptz default now());
  `);
}
module.exports = { pool, init };
