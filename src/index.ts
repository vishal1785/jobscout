/**
 * jobscout - find remote roles worth your evening, and prepare for them.
 *
 *   node src/index.ts            fetch, score, write report + packs
 *   node src/index.ts --no-fetch rebuild report from the stored jobs
 *   node src/index.ts --open     also open the report in your browser
 *   node src/index.ts --no-msg   skip the WhatsApp digest
 *
 * With a KV configured (in CI) the state, report and digest go to Redis instead
 * of the local data/, out/ and drafts/ folders. See the README.
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
import { resolveDirectLinks } from './direct.ts';
import { buildReport } from './report.ts';
import { buildDigest, notify, type WhatsAppConfig } from './notify.ts';
import { kvConfigured, load, save, KEYS } from './store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts: string[]) => join(root, ...parts);
const readJson = (f: string, fallback: any = null) =>
  existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback;

const args = new Set(process.argv.slice(2));
const log = (...m: any[]) => console.log(...m);

/**
 * CI logs on a public repo are world-readable. Counts are fine to print there;
 * which companies he is looking at, and the links, are not. `quiet` is on
 * automatically in CI and can be forced with --quiet.
 */
const quiet = Boolean(process.env.CI) || args.has('--quiet');
const detail = (...m: any[]) => { if (!quiet) console.log(...m); };

async function main() {
  const started = Date.now();
  const profile = readJson(p('profile.json'));
  const watchlist: Watch[] = readJson(p('watchlist.json'), []);
  const storePath = p('data', 'jobs.json');
  const store: { seen: Record<string, string>; jobs: Job[] } =
    kvConfigured
      ? { ...(await load(KEYS.state, storePath, { seen: {} as Record<string, string> })), jobs: [] }
      : readJson(storePath, { seen: {}, jobs: [] });
  if (kvConfigured) log('State: Redis (KV)');

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

  // find each promising company's own posting, so you can apply direct
  if (!args.has('--no-fetch')) {
    log('Looking up company boards...');
    const { resolved, discovered } = await resolveDirectLinks(
      scored, p('data', 'boards.json'),
      { minScore: profile.thresholds.worthALook, maxProbes: 40 },
      log,
    );
    log(`  direct links: ${resolved}`);

    // a company with its own board is worth fetching natively from now on
    if (discovered.length) {
      const known = new Set(watchlist.map((w) => `${w.ats}:${w.token}`));
      let added = 0;
      for (const b of discovered) {
        if (known.has(`${b.ats}:${b.token}`)) continue;
        watchlist.push({ ats: b.ats, token: b.token, label: b.token });
        known.add(`${b.ats}:${b.token}`);
        added++;
      }
      if (added) {
        writeFileSync(p('watchlist.json'), JSON.stringify(watchlist, null, 2), 'utf8');
        log(`  watchlist grew by ${added} board${added === 1 ? '' : 's'}`);
      }
    }
  }

  // carry the direct links back onto the stored jobs, so a --no-fetch rebuild
  // still shows "Apply direct" instead of silently losing them
  const direct = new Map(scored.filter((s) => s.directUrl).map((s) => [s.id, s.directUrl!]));
  for (const j of jobs) {
    const d = direct.get(j.id) ?? j.directUrl;
    if (d) { j.directUrl = d; }
  }
  for (const s of scored) {
    if (!s.directUrl) s.directUrl = direct.get(s.id) ?? jobs.find((j) => j.id === s.id)?.directUrl;
  }

  // prep packs for anything above the threshold
  const packText = new Map<string, string>();
  let packs = 0;
  if (kvConfigured) {
    // no disk in CI: the pack rides along inside the report, which is nicer on a
    // phone anyway - the preparation is on the same screen as the job
    for (const j of scored.filter((s) => s.score >= profile.thresholds.pack)) {
      packText.set(j.id, buildPack(j, profile));
      packs++;
    }
  } else {
    mkdirSync(p('drafts'), { recursive: true });
    const existing = new Set(readdirSync(p('drafts')));
    for (const j of scored.filter((s) => s.score >= profile.thresholds.pack)) {
      const file = `${slug(j)}.md`;
      if (existing.has(file)) continue;        // never overwrite: you may have edited it
      writeFileSync(p('drafts', file), buildPack(j, profile), 'utf8');
      packs++;
    }
  }

  const stats = { fetched: jobs.length, newCount: newIds.size, packs };
  const reportPath = p('out', 'report.html');
  const html = buildReport(scored, newIds, profile, stats, packText);
  await save(KEYS.report, reportPath, html);

  // keep the store small: drop anything not seen in this run and older than 60 days
  const cutoff = Date.now() - 60 * 86_400_000;
  for (const [id, firstSeen] of Object.entries(store.seen)) {
    if (new Date(firstSeen).getTime() < cutoff && !jobs.some((j) => j.id === id)) delete store.seen[id];
  }
  if (kvConfigured) {
    await save(KEYS.state, storePath, JSON.stringify({ seen: store.seen }));
    await save(KEYS.ranAt, p('data', 'ran-at.txt'), new Date().toISOString());
  } else {
    store.jobs = jobs;
    mkdirSync(p('data'), { recursive: true });
    writeFileSync(storePath, JSON.stringify(store), 'utf8');
  }

  const strong = scored.filter((s) => s.score >= profile.thresholds.strong);
  const worth = scored.filter((s) => s.score >= profile.thresholds.worthALook && s.score < profile.thresholds.strong);

  log('');
  log(`Strong matches : ${strong.length}`);
  for (const j of strong.slice(0, 10)) {
    detail(`  ${String(j.score).padStart(3)}  ${j.company} - ${j.title}  [${j.eligibility}]`);
  }
  log(`Worth a look   : ${worth.length}`);
  log(`New since last : ${newIds.size}`);
  log(`Prep packs     : ${packs} written to drafts/`);
  if (!quiet) log(`Report         : ${reportPath}`);
  else log(`Report         : ${kvConfigured ? 'stored in the KV' : 'no KV configured - nothing stored'}`);

  // the digest is only worth sending when something changed, otherwise a daily
  // task turns into a daily notification you learn to ignore
  if (!args.has('--no-msg')) {
    const secrets = readJson(p('secrets.json'), {});
    const cfg: WhatsAppConfig = {
      ...(secrets.whatsapp ?? {}),
      phone: process.env.JOBSCOUT_WA_PHONE ?? secrets.whatsapp?.phone,
      apikey: process.env.JOBSCOUT_WA_APIKEY ?? secrets.whatsapp?.apikey,
    };
    const fresh = scored.filter((s) => newIds.has(s.id) && s.score >= profile.thresholds.worthALook);
    const digest = buildDigest(fresh.length ? fresh : [], newIds, profile, cfg.maxJobs ?? 5);
    log('WhatsApp       :');
    await notify(digest, cfg, p('out', 'digest.txt'), log);
  }

  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (args.has('--open')) spawn('cmd', ['/c', 'start', '', reportPath], { detached: true, stdio: 'ignore' }).unref();
}

main().catch((err) => { console.error('jobscout failed:', err); process.exit(1); });
