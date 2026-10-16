/**
 * jobscout - find remote roles worth your evening, and prepare for them.
 *
 * Runs every morning on GitHub Actions; see the README. Locally:
 *
 *   node src/index.ts             fetch, score, write out/report.html and drafts/
 *   node src/index.ts --no-fetch  rebuild the report from the last fetch
 *   node src/index.ts --open      also open the report in your browser
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
import { resolveDirectLinks, type BoardCache } from './direct.ts';
import { checkForms } from './forms.ts';
import { readCompanies, resolveCompanies } from './companies.ts';
import { buildReport } from './report.ts';
import { buildDigest, notify } from './notify.ts';
import { inCloud, assertCloudConfig, load, save, KEYS } from './store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts: string[]) => join(root, ...parts);
const readJson = (f: string, fallback: any = null) =>
  existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback;

const args = new Set(process.argv.slice(2));
const log = (...m: any[]) => console.log(...m);
// the repo is public and so are its Actions logs: in the cloud the run prints
// counts only, never a company, a score or a link
const detail = (...m: any[]) => { if (!inCloud()) console.log(...m); };

async function main() {
  const started = Date.now();
  assertCloudConfig();
  const profile = readJson(p('profile.json'));
  const secrets = readJson(p('secrets.json'), {});

  // companies.json is the list you keep. Boards discovered by running are a
  // record of where you are looking, so they live in the store and merge in here.
  const boardsPath = p('data', 'watchlist.json');
  const { boards: seed, unwatched } = await resolveCompanies(readCompanies(p('companies.json')));
  log(`Companies: ${seed.length} boards, ${unwatched.length} to check by hand`);
  for (const u of unwatched) detail(`  not fetched: ${u.name} (${u.why})`);
  const found: Watch[] = await load(KEYS.boards, boardsPath, [] as Watch[]);
  const watchlist: Watch[] = [];
  const known = new Set<string>();
  for (const w of [...seed, ...found]) {
    const k = `${w.ats}:${w.token}`;
    if (!known.has(k)) { known.add(k); watchlist.push(w); }
  }

  // what has been shown before. Locally the jobs are kept too, for --no-fetch.
  const statePath = p('data', 'jobs.json');
  const state: { seen: Record<string, string>; jobs?: Job[] } =
    await load(KEYS.state, statePath, { seen: {} as Record<string, string>, jobs: [] as Job[] });

  let jobs: Job[];
  if (args.has('--no-fetch')) {
    jobs = state.jobs ?? [];
    log(`Using ${jobs.length} stored jobs (--no-fetch)`);
  } else {
    log('Fetching sources...');
    jobs = await fetchAll(watchlist, log);
    log(`  total after de-duplication: ${jobs.length}`);
  }

  const newIds = new Set<string>();
  const today = new Date().toISOString();
  for (const j of jobs) {
    if (!state.seen[j.id]) { state.seen[j.id] = today; newIds.add(j.id); }
  }

  let scored: Scored[] = scoreAll(jobs, profile);

  // find each promising company's own posting, so you can apply direct
  if (!args.has('--no-fetch')) {
    log('Looking up company boards...');
    const cachePath = p('data', 'boards.json');
    const before: BoardCache = await load(KEYS.boardCache, cachePath, {} as BoardCache);
    const { resolved, discovered, cache } = await resolveDirectLinks(
      scored, before, { minScore: profile.thresholds.worthALook, maxProbes: 40 }, log,
    );
    await save(KEYS.boardCache, cachePath, JSON.stringify(cache));
    log(`  direct links: ${resolved}`);

    // a company with its own board is worth fetching natively from now on
    const added = discovered.filter((b) => !known.has(`${b.ats}:${b.token}`));
    if (added.length) {
      for (const b of added) { known.add(`${b.ats}:${b.token}`); watchlist.push({ ats: b.ats, token: b.token, label: b.token }); }
      const seeded = new Set(seed.map((w) => `${w.ats}:${w.token}`));
      await save(KEYS.boards, boardsPath, JSON.stringify(watchlist.filter((w) => !seeded.has(`${w.ats}:${w.token}`)), null, 2));
      log(`  watchlist grew by ${added.length} board${added.length === 1 ? '' : 's'}`);
    }

    // keep the direct links on the stored jobs, so --no-fetch still has them
    const direct = new Map(scored.filter((s) => s.directUrl).map((s) => [s.id, s.directUrl!]));
    for (const j of jobs) j.directUrl = direct.get(j.id) ?? j.directUrl;

    // read the forms after the direct links are known, since an aggregator's
    // copy only leads to a form once its company board has been found
    log('Reading application forms...');
    const forms = await checkForms(scored, profile, { minScore: profile.thresholds.worthALook, maxReads: 60 });
    log(`  read: ${forms.read}, unreadable: ${forms.failed}, skipped for US work authorization: ${forms.blocked.size}`);
    for (const j of jobs) {
      const q = forms.blocked.get(j.id);
      if (q) { j.formBlock = q; detail(`    ${j.company} - ${j.title}: "${q}"`); }
    }
    if (forms.blocked.size) scored = scoreAll(jobs, profile);
  }

  // prep packs for anything above the threshold. In the cloud there is no
  // drafts/ folder, so each pack is folded into its card in the report instead.
  const packText = new Map<string, string>();
  let packs = 0;
  const packable = scored.filter((s) => s.score >= profile.thresholds.pack);
  if (inCloud()) {
    for (const j of packable) { packText.set(j.id, buildPack(j, profile)); packs++; }
  } else {
    mkdirSync(p('drafts'), { recursive: true });
    const existing = new Set(readdirSync(p('drafts')));
    for (const j of packable) {
      const file = `${slug(j)}.md`;
      if (existing.has(file)) continue;          // never overwrite: you may have edited it
      writeFileSync(p('drafts', file), buildPack(j, profile), 'utf8');
      packs++;
    }
  }

  const reportPath = p('out', 'report.html');
  const stats = { fetched: jobs.length, newCount: newIds.size, packs };
  await save(KEYS.report, reportPath, buildReport(scored, newIds, profile, stats, packText, state.seen, unwatched));

  // forget ids not seen this run for 60 days, so the state does not only grow
  const cutoff = Date.now() - 60 * 86_400_000;
  const current = new Set(jobs.map((j) => j.id));
  for (const [id, firstSeen] of Object.entries(state.seen)) {
    if (new Date(firstSeen).getTime() < cutoff && !current.has(id)) delete state.seen[id];
  }
  // the full job list only matters locally, for --no-fetch; the cloud keeps ids
  await save(KEYS.state, statePath, JSON.stringify(inCloud() ? { seen: state.seen } : { seen: state.seen, jobs }));

  // counted the way the report lists them: India-based roles have their own tab
  const global = scored.filter((s) => s.eligibility !== 'india');
  const strong = global.filter((s) => s.score >= profile.thresholds.strong);
  const worth = global.filter((s) => s.score >= profile.thresholds.worthALook && s.score < profile.thresholds.strong);
  log('');
  log(`Strong matches : ${strong.length}`);
  for (const j of strong.slice(0, 10)) detail(`  ${String(j.score).padStart(3)}  ${j.company} - ${j.title}  [${j.eligibility}]`);
  log(`Worth a look   : ${worth.length}`);
  log(`Based in India : ${scored.filter((s) => s.eligibility === 'india' && s.score >= (profile.thresholds.india ?? profile.thresholds.worthALook)).length}`);
  log(`New since last : ${newIds.size}`);
  log(`Prep packs     : ${packs}`);
  log(`Report         : ${inCloud() ? 'stored' : reportPath}`);

  // only what is new and good enough: a daily ping about the same jobs is one
  // you learn to ignore
  log('Notification   :');
  const fresh = scored.filter((s) => newIds.has(s.id) && s.score >= profile.thresholds.worthALook);
  await notify(
    buildDigest(fresh, newIds, profile, 5),
    // in cloud mode the topic comes from the environment only: a cloud-mode test
    // run from the laptop's repo folder once picked up secrets.json and pinged
    // the owner's phone
    inCloud() ? process.env.NTFY_TOPIC : process.env.NTFY_TOPIC ?? secrets.ntfyTopic,
    p('out', 'digest.txt'),
    log,
  );

  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (args.has('--open')) spawn('cmd', ['/c', 'start', '', reportPath], { detached: true, stdio: 'ignore' }).unref();
}

main().catch((err) => { console.error('jobscout failed:', err?.stack ?? err); process.exit(1); });
