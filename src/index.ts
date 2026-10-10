/**
 * jobscout - find remote roles worth your evening, and prepare for them.
 *
 *   node src/index.ts            fetch, score, write report + packs
 *   node src/index.ts --no-fetch rebuild report from the stored jobs
 *   node src/index.ts --open     also open the report in your browser
 *
 * Nothing is ever submitted. The tool finds and prepares; you apply.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { fetchAll, type Job, type Watch } from './sources.ts';
import { scoreAll, type Scored } from './score.ts';
import { buildPack, slug } from './tailor.ts';
import { buildReport } from './report.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts: string[]) => join(root, ...parts);
const readJson = (f: string, fallback: any = null) =>
  existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback;

const args = new Set(process.argv.slice(2));
const log = (...m: any[]) => console.log(...m);

async function main() {
  const started = Date.now();
  const profile = readJson(p('profile.json'));
  const watchlist: Watch[] = readJson(p('watchlist.json'), []);
  const storePath = p('data', 'jobs.json');
  const store: { seen: Record<string, string>; jobs: Job[] } = readJson(storePath, { seen: {}, jobs: [] });

  let jobs: Job[] = store.jobs;
  if (!args.has('--no-fetch')) {
    log('Fetching sources...');
    jobs = await fetchAll(watchlist, log);
    log(`  total after de-duplication: ${jobs.length}`);
  } else {
    log(`Using ${jobs.length} stored jobs (--no-fetch)`);
  }

  // what is new since the last run
  const newIds = new Set<string>();
  const today = new Date().toISOString();
  for (const j of jobs) {
    if (!store.seen[j.id]) { store.seen[j.id] = today; newIds.add(j.id); }
  }

  const scored: Scored[] = scoreAll(jobs, profile);

  // prep packs for anything above the threshold, newest first, without rewriting existing ones
  mkdirSync(p('drafts'), { recursive: true });
  const existing = new Set(readdirSync(p('drafts')));
  let packs = 0;
  for (const j of scored.filter((s) => s.score >= profile.thresholds.pack)) {
    const file = `${slug(j)}.md`;
    if (existing.has(file)) continue;          // never overwrite: you may have edited it
    writeFileSync(p('drafts', file), buildPack(j, profile), 'utf8');
    packs++;
  }

  const stats = { fetched: jobs.length, newCount: newIds.size, packs };
  mkdirSync(p('out'), { recursive: true });
  const reportPath = p('out', 'report.html');
  writeFileSync(reportPath, buildReport(scored, newIds, profile, stats), 'utf8');

  // keep the store small: drop anything not seen in this run and older than 60 days
  const cutoff = Date.now() - 60 * 86_400_000;
  store.jobs = jobs;
  for (const [id, firstSeen] of Object.entries(store.seen)) {
    if (new Date(firstSeen).getTime() < cutoff && !jobs.some((j) => j.id === id)) delete store.seen[id];
  }
  mkdirSync(p('data'), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store), 'utf8');

  const strong = scored.filter((s) => s.score >= profile.thresholds.strong);
  const worth = scored.filter((s) => s.score >= profile.thresholds.worthALook && s.score < profile.thresholds.strong);

  log('');
  log(`Strong matches : ${strong.length}`);
  for (const j of strong.slice(0, 10)) {
    log(`  ${String(j.score).padStart(3)}  ${j.company} - ${j.title}  [${j.eligibility}]`);
  }
  log(`Worth a look   : ${worth.length}`);
  log(`New since last : ${newIds.size}`);
  log(`Prep packs     : ${packs} written to drafts/`);
  log(`Report         : ${reportPath}`);
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (args.has('--open')) spawn('cmd', ['/c', 'start', '', reportPath], { detached: true, stdio: 'ignore' }).unref();
}

main().catch((err) => { console.error('jobscout failed:', err); process.exit(1); });
