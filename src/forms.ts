/**
 * Read the application form of each promising job, and skip the ones that ask
 * for US work authorization.
 *
 * A posting can say "Remote" and still hire only in the US; the form gives it
 * away with "Are you legally authorized to work in the United States?". From
 * India that is a dead end however good the match, so such a job is skipped
 * outright (score 0) rather than demoted like other restrictions.
 *
 * Greenhouse publishes a job's questions (?questions=true), Ashby's job page
 * loads its form from a public GraphQL endpoint, and Lever renders the form in
 * the apply page. Only jobs above the worth-a-look line are read, with a cap
 * and a pause, and a form that cannot be read changes nothing.
 */
import type { Scored } from './score.ts';
import { stripHtml, isBoard } from './sources.ts';

type Target = { ats: 'ashby' | 'greenhouse' | 'lever'; token: string; id: string; eu?: boolean };

const UA = 'jobscout/1.0 (personal job search; contact vishal1785@gmail.com)';

// the token and id come from third-party links and go into our own request
// URLs, so they must look like what each ATS actually issues
const TOKEN = /^[A-Za-z0-9._-]{1,80}$/;
const ID: Record<Target['ats'], RegExp> = {
  greenhouse: /^\d{1,20}$/,
  ashby: /^[0-9a-f-]{36}$/i,
  lever: /^[0-9a-f-]{36}$/i,
};

function valid(t: Partial<Target>): Target | null {
  if (t.ats !== 'ashby' && t.ats !== 'greenhouse' && t.ats !== 'lever') return null;
  if (!t.token || !TOKEN.test(t.token) || !t.id || !ID[t.ats].test(t.id)) return null;
  return t as Target;
}

/** Where a job's application form lives, if it is on a board we can read. */
export function formTarget(job: { id: string; source: string; url: string; directUrl?: string }): Target | null {
  // the link comes first, because only it says whether a Lever posting is on
  // the EU instance
  for (const link of [job.directUrl, job.url]) {
    let u: URL;
    try { u = new URL(link ?? ''); } catch { continue; }
    const [token, a, b] = u.pathname.split('/').filter(Boolean);
    let t: Target | null = null;
    if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(u.hostname) && a === 'jobs') t = valid({ ats: 'greenhouse', token, id: b });
    else if (u.hostname === 'jobs.ashbyhq.com') t = valid({ ats: 'ashby', token, id: a });
    else if (/^jobs(\.eu)?\.lever\.co$/.test(u.hostname)) t = valid({ ats: 'lever', token, id: a, eu: u.hostname.includes('.eu.') });
    if (t) return t;
  }
  // a job from a watched board carries its board and posting id in its own id,
  // which covers a Greenhouse posting linked from the company's careers page
  if (isBoard(job.source)) {
    const [ats, token, id] = job.id.split(':');
    return valid({ ats: ats as Target['ats'], token, id });
  }
  return null;
}

/**
 * The application form itself, one step past the posting: Ashby's
 * /application page, Lever's /apply page, the form anchor on a Greenhouse
 * posting, SmartRecruiters' apply view. Null when the job is not on one of them.
 */
export function applyLink(job: { url: string; directUrl?: string }): string | null {
  for (const link of [job.directUrl, job.url]) {
    let u: URL;
    try { u = new URL(link ?? ''); } catch { continue; }
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname === 'jobs.ashbyhq.com' && parts.length === 2) return `${u.origin}/${parts[0]}/${parts[1]}/application`;
    if (/^jobs(\.eu)?\.lever\.co$/.test(u.hostname) && parts.length === 2) return `${u.origin}/${parts[0]}/${parts[1]}/apply`;
    if (/(^|\.)greenhouse\.io$/.test(u.hostname) || u.searchParams.has('gh_jid')) return `${u.origin}${u.pathname}${u.search}#app`;
    if (u.hostname === 'jobs.smartrecruiters.com' && parts.length === 2) return `${u.origin}/${parts[0]}/${parts[1]}?oga=true`;
  }
  return null;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...init.headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

async function questions(t: Target): Promise<string[]> {
  if (t.ats === 'greenhouse') {
    const res = await request(`https://boards-api.greenhouse.io/v1/boards/${t.token}/jobs/${t.id}?questions=true`);
    const d: any = await res.json();
    return (d.questions ?? []).map((q: any) => String(q?.label ?? ''));
  }
  if (t.ats === 'ashby') {
    const body = {
      operationName: 'ApiJobPosting',
      variables: { organizationHostedJobsPageName: t.token, jobPostingId: t.id },
      query: 'query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) { jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) { applicationForm { sections { fieldEntries { ... on FormFieldEntry { field } } } } } }',
    };
    const res = await request('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const d: any = await res.json();
    const sections = d?.data?.jobPosting?.applicationForm?.sections ?? [];
    return sections.flatMap((s: any) => s?.fieldEntries ?? []).map((e: any) => String(e?.field?.title ?? ''));
  }
  const res = await request(`https://jobs${t.eu ? '.eu' : ''}.lever.co/${t.token}/${t.id}/apply`);
  const html = await res.text();
  return [...html.matchAll(/<div class="application-label[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => stripHtml(m[1]));
}

// curly single quotes, built from char codes so the source stays ASCII
const CURLY = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, 'g');

// "U.S.", "U.S.A." and "USA" all become "us", and the British spelling the
// American one, so one short phrase list covers how forms actually word it
export function normalise(label: string): string {
  return label.normalize('NFKC').toLowerCase()
    .replace(CURLY, "'")
    .replace(/authoris/g, 'authoriz')
    .replace(/\bu\.\s?s\.?(?:\s?a\.?)?(?![a-z])/g, 'us ')
    .replace(/\busa\b/g, 'us')
    .replace(/\s+/g, ' ')
    .trim();
}

// a question put only to US applicants says nothing about everyone else, and
// a form that also asks non-US applicants about their own country is open to
// them: DuckDuckGo asks both, and hires worldwide
const US_SCOPED = /^(us|united states) (applicants|candidates|residents)\b|\bif you(?: are|'re|re) (located|based|living|residing) in the (us|united states)\b/;
const ALSO_ELSEWHERE = /\bnon-? ?us\b|\boutside (of )?the (us|united states)\b|\bauthorized to work in your country\b/;

/** The form question that rules out a candidate outside the US, if any. */
export function usAuthQuestion(labels: string[], phrases: string[]): string | null {
  const norm = labels.map(normalise);
  if (norm.some((l) => ALSO_ELSEWHERE.test(l))) return null;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = phrases.map((p) => new RegExp('\\b' + escape(normalise(p)) + '\\b'));
  const i = norm.findIndex((l) => !US_SCOPED.test(l) && patterns.some((re) => re.test(l)));
  return i < 0 ? null : labels[i].replace(/\s+/g, ' ').trim().slice(0, 160);
}

export async function checkForms(
  jobs: Scored[],
  profile: any,
  opts: { minScore: number; maxReads: number },
): Promise<{ read: number; failed: number; blocked: Map<string, string>; asked: Map<string, string[]> }> {
  const phrases: string[] = profile.eligibility.formBlocks ?? [];
  const blocked = new Map<string, string>();
  // every form's questions, kept so the prep pack can draft answers to the
  // ones this employer actually asks
  const asked = new Map<string, string[]>();
  let read = 0;
  let failed = 0;
  for (const job of jobs) {
    if (job.score < opts.minScore) continue;
    if (read >= opts.maxReads) break;
    const target = formTarget(job);
    if (!target) continue;
    read++;
    try {
      // every real form asks at least for a name: an empty one means the ATS
      // changed its format, and should show up as unreadable, not as clean
      const labels = await questions(target);
      if (!labels.length) throw new Error('no questions found');
      asked.set(job.id, labels.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
      const q = usAuthQuestion(labels, phrases);
      if (q) blocked.set(job.id, q);
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { read, failed, blocked, asked };
}
