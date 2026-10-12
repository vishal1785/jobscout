/**
 * A keyhole onto the KV, so nothing else needs the KV credentials.
 *
 * Vercel already holds them, and reads them from its own environment here.
 * The laptop and GitHub Actions talk to this instead, which means the
 * credentials are never copied anywhere - and if they are ever rotated, they
 * are rotated in one place.
 *
 *   GET  /api/store?k=<REPORT_KEY>&key=jobscout:state    read
 *   POST /api/store?k=<PUBLISH_KEY>&key=jobscout:report  write, body is the value
 *
 * Reads use the same key as the report. Writes need PUBLISH_KEY, a separate
 * secret, because the report key travels in every notification URL and lands
 * in browser history: whoever can read the report still must not be able to
 * replace it.
 */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const MAX_BYTES = 4 * 1024 * 1024;

const json = (res, code, body) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  res.status(code).json(body);
};

/** Timing-safe enough for a shared secret compared character by character. */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  if (!KV_URL || !KV_TOKEN) return json(res, 500, { error: 'no KV connected to this deployment' });

  const url = new URL(req.url, 'http://x');
  const k = url.searchParams.get('k') ?? '';
  const key = url.searchParams.get('key') ?? '';
  const writing = req.method === 'POST';

  // only this tool's own keys, so a leaked key cannot roam the whole database
  if (!/^jobscout:[a-z-]{1,40}$/.test(key)) return json(res, 400, { error: 'bad key' });

  // writing needs the publish key; reading accepts either, since whoever may
  // replace the report may obviously also read it
  const allowed = writing
    ? [process.env.PUBLISH_KEY]
    : [process.env.PUBLISH_KEY, process.env.REPORT_KEY];
  if (!allowed.some(Boolean)) {
    return json(res, 500, { error: `${writing ? 'PUBLISH_KEY' : 'REPORT_KEY'} is not set` });
  }
  if (!allowed.filter(Boolean).some((e) => same(k, e))) return json(res, 404, { error: 'not found' });

  try {
    if (!writing) {
      const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { authorization: `Bearer ${KV_TOKEN}` },
      });
      if (!r.ok) return json(res, 502, { error: `kv ${r.status}` });
      return json(res, 200, { result: (await r.json()).result });
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > MAX_BYTES) return json(res, 413, { error: 'too large' });
    }
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'text/plain' },
      body,
    });
    if (!r.ok) return json(res, 502, { error: `kv ${r.status}` });
    return json(res, 200, { ok: true, bytes: body.length });
  } catch (err) {
    return json(res, 502, { error: String(err.message).slice(0, 120) });
  }
}
