/**
 * Find the company's own posting, not the aggregator's copy.
 *
 * Applying direct is better: the listing is current, the form is theirs, and no
 * middleman is attached to your name. Aggregators rarely link there, so for the
 * jobs worth your time we look the company up on the three boards that publish
 * open APIs, cache what we learn, and remember which companies have no board.
 *
 * Deliberately polite: only the jobs above the score threshold, a hard cap per
 * run, a pause between probes, and a cache so a company is only looked up once.
 */
import type { Scored } from './score.ts';
import { isBoard } from './sources.ts';

type BoardHit = { ats: 'ashby' | 'greenhouse' | 'lever'; token: string; postings: Array<{ title: string; url: string }> };
// the cache remembers WHICH board a company uses, not its postings: those are
// fetched fresh from the watchlist on the next run anyway, and keeping every
// posting of every company would bloat the store a little more each day
type CacheEntry = { checked: string; board: { ats: BoardHit['ats']; token: string } | null };
export type BoardCache = Record<string, CacheEntry>;

const UA = 'jobscout/1.0 (personal job search; contact vishal1785@gmail.com)';
const CACHE_DAYS = 21;

export function slugVariants(company: string): string[] {
  const base = company
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|llc|ltd|limited|bv|b\.v|ab|gmbh|corp|co|company|group|labs|technologies|technology|software|solutions)\b/g, '')
    .trim();
  const hyphen = base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tight = base.replace(/[^a-z0-9]+/g, '');
  return [...new Set([hyphen, tight].filter((s) => s.length >= 2 && s.length <= 40))];
}

export async function tryBoard(ats: BoardHit['ats'], token: string): Promise<BoardHit | null> {
  const url =
    ats === 'ashby' ? `https://api.ashbyhq.com/posting-api/job-board/${token}`
    : ats === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`
    : `https://api.lever.co/v0/postings/${token}?mode=json`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) return null;
    const data: any = await res.json();
    const rows = ats === 'lever' ? data : (data.jobs ?? []);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const postings = rows.map((j: any) => ({
      title: String(j.title ?? j.text ?? ''),
      url: String(j.jobUrl ?? j.absolute_url ?? j.hostedUrl ?? ''),
    })).filter((x) => x.title && x.url);
    return postings.length ? { ats, token, postings } : null;
  } catch {
    return null;
  }
}

/** Fuzzy-match a title against the company's own postings. */
function bestPosting(title: string, postings: Array<{ title: string; url: string }>): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const want = new Set(norm(title).split(' ').filter((w) => w.length > 2));
  let best: { url: string; score: number } | null = null;
  for (const p of postings) {
    const got = new Set(norm(p.title).split(' ').filter((w) => w.length > 2));
    const overlap = [...want].filter((w) => got.has(w)).length;
    const score = overlap / Math.max(want.size, 1);
    if (!best || score > best.score) best = { url: p.url, score };
  }
  return best && best.score >= 0.5 ? best.url : null;
}

export function boardHome(board: { ats: BoardHit['ats']; token: string }): string {
  return board.ats === 'ashby' ? `https://jobs.ashbyhq.com/${board.token}`
    : board.ats === 'greenhouse' ? `https://boards.greenhouse.io/${board.token}`
    : `https://jobs.lever.co/${board.token}`;
}

export async function resolveDirectLinks(
  jobs: Scored[],
  cache: BoardCache,
  opts: { minScore: number; maxProbes: number },
  log = console.log,
): Promise<{ resolved: number; discovered: BoardHit[]; cache: BoardCache }> {
  const fresh = (e?: CacheEntry) => e && Date.now() - new Date(e.checked).getTime() < CACHE_DAYS * 86_400_000;

  const discovered: BoardHit[] = [];
  let probes = 0;
  let resolved = 0;

  for (const job of jobs) {
    if (job.directUrl) continue;                       // the source already gave us one
    if (job.score < opts.minScore) continue;
    if (isBoard(job.source)) continue;               // already a direct board

    const key = job.company.toLowerCase().trim();
    let entry = cache[key];
    let found: BoardHit | null = null;            // postings, only on the run that finds it

    if (!fresh(entry)) {
      if (probes >= opts.maxProbes) continue;
      let board: BoardHit | null = null;
      outer: for (const token of slugVariants(job.company)) {
        for (const ats of ['ashby', 'greenhouse', 'lever'] as const) {
          probes++;
          board = await tryBoard(ats, token);
          await new Promise((r) => setTimeout(r, 150));
          if (board) break outer;
          if (probes >= opts.maxProbes * 3) break outer;
        }
      }
      entry = { checked: new Date().toISOString(), board: board && { ats: board.ats, token: board.token } };
      cache[key] = entry;
      found = board;
      if (board) {
        discovered.push(board);
        // the company name stays out of CI logs: they are public on a public repo
        log(process.env.CI ? '  found a company board' : `  found board: ${job.company} -> ${board.ats}/${board.token}`);
      }
    }

    if (entry?.board) {
      job.directUrl = (found && bestPosting(job.title, found.postings)) ?? boardHome(entry.board);
      resolved++;
    }
  }

  // forget lookups older than the cache window, so the store does not only grow
  for (const [k, e] of Object.entries(cache)) if (!fresh(e)) delete cache[k];
  return { resolved, discovered, cache };
}
