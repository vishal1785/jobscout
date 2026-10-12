/**
 * Serves the latest report at a real, clickable URL.
 *
 * The code repo is public, so the report is NOT in it: GitHub Actions writes
 * the rendered HTML into Redis and this reads it back. Access needs ?k=<key>
 * matching REPORT_KEY, because a list of where someone is applying is nobody
 * else's business even if the URL leaks into a browser history.
 */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  return (await res.json()).result;
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0F3B33;color:#E4F0EC;
font-family:ui-monospace,Consolas,monospace;font-size:14px;text-align:center;padding:24px;line-height:1.6}</style>
</head><body><div>${body}</div></body></html>`;

export default async function handler(req, res) {
  const key = new URL(req.url, 'http://x').searchParams.get('k');
  const expected = process.env.REPORT_KEY;

  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow');

  if (!expected) {
    res.status(500).send(page('Not configured', 'REPORT_KEY is not set on this deployment.'));
    return;
  }
  if (key !== expected) {
    res.status(404).send(page('Not found', 'Nothing here.'));
    return;
  }
  if (!KV_URL || !KV_TOKEN) {
    res.status(500).send(page('Not configured', 'No KV connected to this deployment.'));
    return;
  }

  try {
    const html = await kvGet('jobscout:report');
    if (!html) {
      res.status(200).send(page('No report yet', 'The scout has not run yet.<br>It runs at 08:00 IST daily.'));
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    res.status(502).send(page('Upstream error', `Could not read the report.<br>${err.message}`));
  }
}
