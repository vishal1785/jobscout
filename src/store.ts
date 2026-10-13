/**
 * Where state lives.
 *
 * On a laptop: plain files under data/ and out/.
 * On GitHub Actions there is no disk worth keeping, so state goes to the
 * deployment's /api/store, which writes it to the KV using credentials that
 * only Vercel holds. The repo is public, so generated data never goes in git.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const site = (process.env.JOBSCOUT_SITE ?? '').replace(/\/+$/, '');
const publishKey = process.env.PUBLISH_KEY ?? '';

/** GitHub Actions sets CI. Anywhere else it is always local files. */
export const inCloud = () => Boolean(process.env.CI);

/** A cloud run that cannot store anything is a failure, so say which secret is missing. */
export function assertCloudConfig(): void {
  if (!inCloud()) return;
  const missing = [
    !/^https?:\/\//i.test(site) && 'JOBSCOUT_SITE',
    !publishKey && 'PUBLISH_KEY',
  ].filter(Boolean);
  if (missing.length) throw new Error(`missing GitHub secret: ${missing.join(', ')}`);
}

async function remote(key: string, body?: string): Promise<any> {
  const res = await fetch(`${site}/api/store?key=${encodeURIComponent(key)}`, {
    method: body === undefined ? 'GET' : 'POST',
    // a header, not the query string, so the key stays out of access logs
    headers: { authorization: `Bearer ${publishKey}`, ...(body === undefined ? {} : { 'content-type': 'text/plain' }) },
    body,
  });
  if (!res.ok) {
    throw new Error(`store ${body === undefined ? 'read' : 'write'} of ${key}: http ${res.status} ${(await res.text()).slice(0, 120)}`);
  }
  return res.json();
}

export const KEYS = {
  state: 'jobscout:state',             // ids already shown, so "new" really means new
  report: 'jobscout:report',           // the rendered page
  boards: 'jobscout:watchlist',        // company boards found by running, kept out of git
  boardCache: 'jobscout:board-cache',  // which companies were already looked up
};

/** Read JSON from the store in the cloud, from a file locally. */
export async function load<T>(key: string, file: string, fallback: T): Promise<T> {
  if (!inCloud()) return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
  try {
    const { result } = await remote(key);
    return result ? (JSON.parse(result) as T) : fallback;
  } catch (err: any) {
    // an unreachable store degrades a run to "everything is new", it does not stop it
    console.log(`  could not read ${key} (${err.message}) - continuing without it`);
    return fallback;
  }
}

/** Write to the store in the cloud, to a file locally. */
export async function save(key: string, file: string, value: string): Promise<void> {
  if (inCloud()) {
    await remote(key, value);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value, 'utf8');
}
