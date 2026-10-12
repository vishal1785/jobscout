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

const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';

export const kvConfigured = Boolean(url && token);

async function kv(path: string, body?: string): Promise<any> {
  const res = await fetch(`${url}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'text/plain' }) },
    body,
  });
  if (!res.ok) throw new Error(`kv ${path.split('/')[0]} ${res.status}: ${(await res.text()).slice(0, 120)}`);
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
  if (kvConfigured) {
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
export async function save(key: string, file: string, value: string): Promise<void> {
  if (kvConfigured) {
    await kv(`set/${encodeURIComponent(key)}`, value);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value, 'utf8');
}
