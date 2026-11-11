// Vercel serverless function: channel NAME -> matching channels -> latest long videos.
const API = 'https://www.googleapis.com/youtube/v3/';
async function yt(path, params) {
  const u = new URL(API + path);
  Object.entries({ ...params, key: process.env.YOUTUBE_API_KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'YouTube API error');
  return j;
}
const secs = (d) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || '') || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};

async function latest(uploads, minutes = 5) {
  const p = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 30 });
  const ids = p.items.map((i) => i.contentDetails.videoId).join(',');
  if (!ids) return [];
  const v = await yt('videos', { part: 'snippet,contentDetails', id: ids });
  return v.items
    .map((x) => ({
      id: x.id,
      title: x.snippet.title,
      date: x.snippet.publishedAt,
      seconds: secs(x.contentDetails.duration),
      thumb: (x.snippet.thumbnails.medium || x.snippet.thumbnails.default || {}).url,
    }))
    .filter((x) => x.seconds >= minutes * 60)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 12);
}

module.exports = async (req, res) => {
  const need = process.env.APP_PASSWORD;
  if (need && req.headers['x-access-code'] !== need) return res.status(401).json({ error: 'Access code needed' });
  if (!process.env.YOUTUBE_API_KEY) return res.status(500).json({ error: 'Server is missing YOUTUBE_API_KEY' });
  const { q, uploads } = req.query;
  try {
    if (q) {
      const s = await yt('search', { part: 'snippet', type: 'channel', q: String(q).slice(0, 100), maxResults: 4 });
      const ids = s.items.map((i) => i.id.channelId).filter(Boolean).join(',');
      if (!ids) return res.status(200).json({ channels: [] });
      const c = await yt('channels', { part: 'snippet,statistics,contentDetails', id: ids });
      return res.status(200).json({
        channels: c.items.map((x) => ({
          id: x.id,
          title: x.snippet.title,
          thumb: (x.snippet.thumbnails.default || {}).url,
          subs: x.statistics.hiddenSubscriberCount ? null : Number(x.statistics.subscriberCount),
          uploads: x.contentDetails.relatedPlaylists.uploads,
        })),
      });
    }
    if (uploads && /^UU[\w-]+$/.test(uploads)) {
      return res.status(200).json({ videos: await latest(uploads, Number(req.query.minutes) || 5) });
    }
    return res.status(400).json({ error: 'Send ?q=channel name' });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
module.exports.latest = latest;
