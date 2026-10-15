/**
 * The companies to watch, from companies.json.
 *
 * A company is added by name, and this finds its board. A name alone is looked
 * up on Ashby, Greenhouse and Lever on every run, which is a handful of
 * requests; an explicit "board" skips the guess, and is needed when a slug
 * belongs to someone else ("wise" on Greenhouse is a field-sales firm; the
 * Wise that moves money is on SmartRecruiters).
 *
 *   node src/companies.ts    what each entry resolves to, with its job count
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchBoard, type Watch } from './sources.ts';
import { slugVariants, tryBoard } from './direct.ts';

export type Company = { name: string; board?: string; careers?: string };
/** A listed company whose jobs cannot be fetched, shown in the report to check by hand. */
export type Unwatched = { name: string; careers?: string; why: string };

const ATS: ReadonlyArray<Watch['ats']> = ['ashby', 'greenhouse', 'lever', 'lever-eu', 'smartrecruiters'];

export function parseBoard(board: string, label: string): Watch | null {
  const m = /^([a-z-]+):([A-Za-z0-9._-]{1,80})$/.exec(board.trim());
  if (!m || !ATS.includes(m[1] as Watch['ats'])) return null;
  return { ats: m[1] as Watch['ats'], token: m[2], label };
}

export async function resolveCompanies(list: Company[]): Promise<{ boards: Watch[]; unwatched: Unwatched[] }> {
  const boards: Watch[] = [];
  const unwatched: Unwatched[] = [];
  for (const c of list) {
    const name = String(c?.name ?? '').trim();
    if (!name) continue;
    if (c.board) {
      const w = parseBoard(c.board, name);
      if (w) boards.push(w);
      else unwatched.push({ name, careers: c.careers, why: `"board" should be ats:token, not "${c.board}"` });
      continue;
    }
    if (c.careers) {
      unwatched.push({ name, careers: c.careers, why: 'no job board that can be read' });
      continue;
    }
    let hit: Awaited<ReturnType<typeof tryBoard>> = null;
    outer: for (const token of slugVariants(name)) {
      for (const ats of ['ashby', 'greenhouse', 'lever'] as const) {
        hit = await tryBoard(ats, token);
        if (hit) break outer;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    if (hit) boards.push({ ats: hit.ats, token: hit.token, label: name });
    else unwatched.push({ name, why: 'no board found on Ashby, Greenhouse or Lever' });
  }
  return { boards, unwatched };
}

export function readCompanies(file: string): Company[] {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(data?.companies) ? data.companies : [];
}

// run directly: show what each entry resolves to, so a lookup that landed on
// the wrong company is caught before it fills the report with someone else's jobs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'companies.json');
  const { boards, unwatched } = await resolveCompanies(readCompanies(file));
  for (const w of boards) {
    try {
      const jobs = await fetchBoard(w);
      const sample = jobs.slice(0, 2).map((j) => `${j.title} @ ${j.location}`).join('; ');
      console.log(`${(w.label ?? w.token).padEnd(18)} ${`${w.ats}:${w.token}`.padEnd(32)} ${String(jobs.length).padStart(3)} jobs  ${sample}`);
    } catch (err: any) {
      console.log(`${(w.label ?? w.token).padEnd(18)} ${`${w.ats}:${w.token}`.padEnd(32)} FAILED (${err.message})`);
    }
  }
  for (const u of unwatched) console.log(`${u.name.padEnd(18)} not fetched: ${u.why}${u.careers ? ` - ${u.careers}` : ''}`);
}
