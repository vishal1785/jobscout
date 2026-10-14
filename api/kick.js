/**
 * Starts the morning run on GitHub Actions.
 *
 * GitHub's own scheduler is best-effort: runs queue behind everyone else's and
 * have arrived hours late or not at all. Vercel's cron fires within the hour,
 * so it calls this, and this asks GitHub to run the workflow now - the same as
 * pressing "Run workflow". The GitHub schedule stays on as a backup.
 *
 * Vercel sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set,
 * which keeps anyone else from triggering runs.
 */
const REPO = process.env.GITHUB_REPO || 'vishal1785/jobscout';

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(req.headers?.authorization ?? '', `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return res.status(500).json({ error: 'GH_DISPATCH_TOKEN is not set' });

  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/daily.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'jobscout-kick',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (r.status !== 204) {
    return res.status(502).json({ error: `github answered ${r.status}`, detail: (await r.text()).slice(0, 200) });
  }
  return res.status(200).json({ ok: true, dispatched: new Date().toISOString() });
}
