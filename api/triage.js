/**
 * "Applied" and "Not interested" marks from the report page, so later runs
 * leave those jobs out.
 *
 *   POST /api/triage  (Authorization: Bearer <REPORT_KEY>)
 *        body {"key": "<company|title>", "status": "applied" | "dismissed" | "undo"}
 *   GET  /api/triage  (Authorization: Bearer <PUBLISH_KEY or REPORT_KEY>)
 *        -> {"result": {"<company|title>": {"status": "...", "at": "<ISO date>"}}}
 *
 * Until this, the report key could only read. The page has to write this one
 * thing, and whatever the page can do, whoever holds its URL can do too. So the
 * report key may add or remove marks here and nothing more: it still cannot
 * replace the report or touch any other key. The worst a leaked link allows is
 * hiding jobs from him, and a hidden job can be restored from the report.
 *
 * Marks live in a Redis hash, so each mark is one atomic write: two quick taps
 * on two jobs cannot overwrite each other the way a read-modify-write could.
 */
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH = 'jobscout:triage';
const STATUSES = new Set(['applied', 'dismissed', 'undo']);

const json = (res, code, body) => {
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  res.status(code).json(body);
};

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** One Redis command through Upstash's REST API, as a JSON array. */
async function kv(command) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${KV_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  return (await r.json()).result;
}

export default async function handler(req, res) {
  if (!KV_URL || !KV_TOKEN) return json(res, 500, { error: 'no KV connected to this deployment' });
  const k = /^Bearer (.+)$/.exec(req.headers?.authorization ?? '')?.[1] ?? '';
  const writing = req.method === 'POST';
  const allowed = (writing ? [process.env.REPORT_KEY] : [process.env.PUBLISH_KEY, process.env.REPORT_KEY]).filter(Boolean);
  if (!allowed.length) return json(res, 500, { error: 'REPORT_KEY is not set' });
  if (!allowed.some((e) => same(k, e))) return json(res, 404, { error: 'not found' });

  try {
    if (!writing) {
      const flat = (await kv(['HGETALL', HASH])) ?? [];
      const result = {};
      for (let i = 0; i + 1 < flat.length; i += 2) {
        try { result[flat[i]] = JSON.parse(flat[i + 1]); } catch { /* a bad entry is skipped, not fatal */ }
      }
      return json(res, 200, { result });
    }

    // sent as text/plain, so the platform hands over the raw body to parse here
    // bytes first, decoded once, so a character split across chunks survives
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2048) return json(res, 413, { error: 'too large' });
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    let input;
    try { input = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
    const key = typeof input?.key === 'string' ? input.key.trim() : '';
    const status = input?.status;
    // the key is company|title from the page: printable, short, nothing else
    if (!key || key.length > 240 || /[\u0000-\u001f\u007f]/.test(key) || !STATUSES.has(status)) {
      return json(res, 400, { error: 'bad key or status' });
    }

    if (status === 'undo') await kv(['HDEL', HASH, key]);
    else await kv(['HSET', HASH, key, JSON.stringify({ status, at: new Date().toISOString() })]);
    return json(res, 200, { ok: true });
  } catch (err) {
    return json(res, 502, { error: String(err.message).slice(0, 120) });
  }
}
