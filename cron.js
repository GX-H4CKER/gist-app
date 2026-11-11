// Runs once a day on Render: checks followed channels, picks fresh videos, writes summaries into the review queue.
const { pool, init } = require('./lib/db');
const { summarizeVideo } = require('./api/summarize');
const { latest } = require('./api/channel');
const PER_DAY = Number(process.env.POSTS_PER_DAY) || 2;

(async () => {
  await init();
  const { rows: follows } = await pool.query('select * from follows');
  const cands = [];
  for (const f of follows) {
    try {
      for (const v of (await latest(f.uploads, 5)).slice(0, 3)) {
        const seen = await pool.query('select 1 from queue where video_id=$1', [v.id]);
        if (!seen.rowCount && Date.now() - new Date(v.date) < 7 * 864e5) cands.push({ ...v, channel_id: f.channel_id, channel_title: f.title });
      }
    } catch (e) { console.error('Channel failed:', f.title, e.message); }
  }
  cands.sort((a, b) => new Date(b.date) - new Date(a.date));
  let made = 0;
  for (const c of cands) {
    if (made >= PER_DAY) break;
    try {
      const data = await summarizeVideo(c.id);
      await pool.query('insert into queue(video_id,channel_id,channel_title,title,data) values($1,$2,$3,$4,$5) on conflict do nothing',
        [c.id, c.channel_id, c.channel_title, data.title || c.title, data]);
      made++; console.log('Queued:', c.title);
    } catch (e) { console.error('Skipped:', c.title, e.message); }
  }
  console.log('Done. Queued', made, 'of', cands.length, 'candidates.');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
