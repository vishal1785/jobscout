/**
 * Where state lives.
 *
 * On the laptop: plain files under data/ and out/, as before.
 * In CI: there is no laptop and no writable disk worth keeping, so the run
 * state, the rendered report and the digest go into a Redis (Upstash/Vercel KV)
 * over its REST API - no driver, no dependency, just fetch.
 *
 * The code repo is public, so the generated data deliberately does NOT live in
 * it. Nobody should be able to read this job hunt by browsing the repo.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
let token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

// Talking to the deployment instead of to the KV directly. Vercel already holds
// the KV credentials, so this way they are never copied onto a laptop or into a
// second set of CI secrets - one key to publish, and nothing else to keep safe.
let site = process.env.JOBSCOUT_SITE ?? '';
let publishKey = process.env.PUBLISH_KEY ?? '';

// the example file ships with PASTE-ME placeholders, and a half-filled
// secrets.json must not look like working credentials
const real = (v?: string) => Boolean(v && /^https?:\/\//i.test(v));

/** Lets secrets.json supply the credentials, so the laptop needs no env vars. */
export function configureKv(u?: string, t?: string): void {
  if (real(u) && t && !/^PASTE/i.test(t)) { url = u!; token = t; }
}

/** The deployment's base URL plus the publish key, as an alternative to the above. */
export function configureSite(s?: string, k?: string): void {
  if (real(s) && k && !/^PASTE/i.test(k)) { site = s!.replace(/\/+$/, ''); publishKey = k; }
}

export const kvReady = () => Boolean((url && token) || (site && publishKey));
const viaSite = () => !(url && token) && Boolean(site && publishKey);

/**
 * Whether this run keeps its state in the KV instead of local files. In CI there
 * is no disk worth writing to; on the laptop the files stay authoritative even
 * when credentials exist, so a local run cannot quietly diverge from them.
 */
export const kvConfigured = () => kvReady() && Boolean(process.env.CI);

async function kv(path: string, body?: string): Promise<any> {
  const [verb, rawKey] = path.split('/');

  const target = viaSite()
    ? `${site}/api/store?k=${encodeURIComponent(publishKey)}&key=${rawKey}`
    : `${url}/${path}`;
  const headers: Record<string, string> = viaSite()
    ? {}
    : { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'text/plain';

  const res = await fetch(target, { method: body === undefined ? 'GET' : 'POST', headers, body });
  if (!res.ok) throw new Error(`store ${verb} ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

export const KEYS = {
  state: 'jobscout:state',       // { seen } - what has been shown before
  report: 'jobscout:report',     // the rendered HTML
  digest: 'jobscout:digest',     // the WhatsApp text, for the record
  ranAt: 'jobscout:ran-at',
  boards: 'jobscout:watchlist',  // company boards found by running it, not a repo file
};

/** Read JSON, from the KV when configured, else from the file. */
export async function load<T>(key: string, file: string, fallback: T): Promise<T> {
  if (kvConfigured()) {
    try {
      const { result } = await kv(`get/${encodeURIComponent(key)}`);
      if (result) return JSON.parse(result) as T;
    } catch (err: any) {
      // a cold or unreachable KV must not stop a run: it degrades to "all new"
      console.log(`  kv read failed (${err.message}) - continuing without history`);
    }
    return fallback;
  }
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
}

/** Write a value both places that make sense: KV in CI, file on the laptop. */
export async function save(key: string, file: string, value: string, alsoKv = false): Promise<void> {
  if (kvConfigured()) {
    await kv(`set/${encodeURIComponent(key)}`, value);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value, 'utf8');
  // --publish: a laptop run can push its report to the hosted page as well,
  // which is how you see it online before the first scheduled run
  if (alsoKv && kvReady()) await kv(`set/${encodeURIComponent(key)}`, value);
}
