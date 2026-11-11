const express = require('express');
const path = require('path');
const { pool, init } = require('./lib/db');
const app = express();
app.use(express.json());

const guard = (req, res, next) => {
  const need = process.env.APP_PASSWORD;
  if (need && req.headers['x-access-code'] !== need) return res.status(401).json({ error: 'Access code needed' });
  next();
};
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

app.get('/api/channel', guard, require('./api/channel'));
app.post('/api/summarize', guard, require('./api/summarize'));

app.get('/api/follows', guard, wrap(async (req, res) => {
  res.json((await pool.query('select channel_id as id, title, thumb, uploads from follows order by added_at desc')).rows);
}));
app.post('/api/follows', guard, wrap(async (req, res) => {
  const { id, title, thumb, uploads } = req.body || {};
  if (!id || !/^UU[\w-]+$/.test(uploads || '')) return res.status(400).json({ error: 'Bad channel' });
  await pool.query('insert into follows(channel_id,title,thumb,uploads) values($1,$2,$3,$4) on conflict (channel_id) do nothing', [id, title, thumb, uploads]);
  res.json({ ok: true });
}));
app.delete('/api/follows/:id', guard, wrap(async (req, res) => {
  await pool.query('delete from follows where channel_id=$1', [req.params.id]);
  res.json({ ok: true });
}));
app.get('/api/queue', guard, wrap(async (req, res) => {
  res.json((await pool.query('select video_id as id, channel_title, title, data, status, created_at from queue order by created_at desc limit 30')).rows);
}));
app.post('/api/queue/:id', guard, wrap(async (req, res) => {
  const s = (req.body || {}).status;
  if (!['approved', 'rejected', 'pending'].includes(s)) return res.status(400).json({ error: 'Bad status' });
  await pool.query('update queue set status=$1 where video_id=$2', [s, req.params.id]);
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public')));
init().then(() => app.listen(process.env.PORT || 3000, () => console.log('Gist is running')))
  .catch((e) => { console.error('Database error:', e.message); process.exit(1); });
