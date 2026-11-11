// YouTube video -> transcript -> AI summary, takeaways, best moments.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const fail = (status, message) => Object.assign(new Error(message), { status });

function videoId(u) {
  const s = String(u || '').trim();
  const m = s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(s) ? s : null;
}
const clock = (t) => {
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const decode = (x) => x.replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function toBlocks(segs) {
  // offsets may be seconds or milliseconds depending on package version, so detect it
  const ms = segs.length > 1 && (segs[segs.length - 1].offset - segs[0].offset) / (segs.length - 1) > 100;
  const blocks = [];
  let start = -999, cur = null;
  for (const s of segs) {
    const t = ms ? s.offset / 1000 : s.offset;
    if (t - start >= 30) { cur = { t, text: '' }; blocks.push(cur); start = t; }
    cur.text += ' ' + decode(s.text);
  }
  return blocks.map((b) => `[${clock(b.t)}|${Math.floor(b.t)}] ${b.text.trim()}`).join('\n');
}

async function summarizeVideo(id) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw fail(500, 'Server is missing ANTHROPIC_API_KEY');
  let text;
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const segs = await YoutubeTranscript.fetchTranscript(id);
    if (!segs || !segs.length) throw new Error('empty');
    text = toBlocks(segs);
  } catch (e) {
    throw fail(422, 'Could not get a transcript for this video. It may have captions turned off, or YouTube blocked the request. Try another video.');
  }
  if (text.length > 120000) text = text.slice(0, 120000);

  const prompt = `Below is a timestamped transcript of a YouTube video. Each line looks like [m:ss|seconds] text.
Write for someone too busy to watch the whole thing. Reply with ONLY valid JSON, no markdown, in this shape:
{"title":"short descriptive title",
"summary":"about 120 words, plain and engaging",
"takeaways":[{"text":"one clear point","time":SECONDS}],
"moments":[{"title":"short catchy label","why":"one sentence on why it is worth watching","time":SECONDS}],
"quotes":["strong standalone line, lightly cleaned up"]}
Give 5 to 8 takeaways, 4 to 6 moments and 3 to 5 quotes. "time" must be an integer taken from the transcript's seconds value.

TRANSCRIPT:
${text}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw fail(502, (data.error && data.error.message) || 'AI request failed');
  const raw = (data.content || []).map((c) => c.text || '').join('');
  try {
    const out = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    out.videoId = id;
    return out;
  } catch (e) {
    throw fail(502, 'The AI reply could not be read. Please try again.');
  }
}

module.exports = async (req, res) => {
  const need = process.env.APP_PASSWORD;
  if (need && req.headers['x-access-code'] !== need) return res.status(401).json({ error: 'Access code needed' });
  const id = videoId((req.body || {}).url);
  if (!id) return res.status(400).json({ error: 'That does not look like a YouTube link' });
  try { res.status(200).json(await summarizeVideo(id)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
module.exports.summarizeVideo = summarizeVideo;
