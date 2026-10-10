/**
 * Job sources. All public endpoints, no logins, no scraping behind auth.
 * Each adapter returns a plain Job[]; failures are isolated so one dead
 * source never stops a run.
 */

export type Job = {
  id: string;
  source: string;
  company: string;
  title: string;
  location: string;
  url: string;
  postedAt: string;      // ISO date, best effort
  description: string;   // plain text, lowercased later for matching
  tags: string[];
  salary?: string;
  directUrl?: string;    // the company's own posting, when we can find it
};

const UA = 'jobscout/1.0 (personal job search; contact vishal1785@gmail.com)';

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

export function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------------------------------------------------------- RemoteOK */
async function remoteok(): Promise<Job[]> {
  const rows = await getJson('https://remoteok.com/api');
  return rows
    .filter((r: any) => r && r.id && r.position)
    .map((r: any) => ({
      id: `remoteok:${r.id}`,
      source: 'RemoteOK',
      company: r.company ?? 'Unknown',
      title: r.position,
      location: r.location || 'Remote',
      url: r.url || `https://remoteok.com/remote-jobs/${r.id}`,
      directUrl: typeof r.apply_url === 'string' && !/remoteok\./i.test(r.apply_url) ? r.apply_url : undefined,
      postedAt: r.date ?? new Date().toISOString(),
      description: stripHtml(r.description ?? ''),
      tags: Array.isArray(r.tags) ? r.tags : [],
      salary: r.salary_min ? `${r.salary_min}-${r.salary_max}` : undefined,
    }));
}

/* --------------------------------------------------------------- Remotive */
async function remotive(): Promise<Job[]> {
  // no category filter: their taxonomy misses plenty of engineering roles, and
  // scoring throws out anything irrelevant anyway
  const data = await getJson('https://remotive.com/api/remote-jobs?limit=400');
  return (data.jobs ?? []).map((j: any) => ({
    id: `remotive:${j.id}`,
    source: 'Remotive',
    company: j.company_name ?? 'Unknown',
    title: j.title,
    location: j.candidate_required_location || 'Remote',
    url: j.url,
    postedAt: j.publication_date ?? new Date().toISOString(),
    description: stripHtml(j.description ?? ''),
    tags: j.tags ?? [],
    salary: j.salary || undefined,
  }));
}

/* --------------------------------------------------------------- Himalayas */
async function himalayas(): Promise<Job[]> {
  // the API pages at 20; walk a few pages rather than taking the first slice
  const rows: any[] = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const page = await getJson(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`);
    const batch = page.jobs ?? [];
    rows.push(...batch);
    if (batch.length < 20) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return rows.map((j: any) => ({
    id: `himalayas:${j.guid ?? j.id ?? j.applicationLink}`,
    source: 'Himalayas',
    company: j.companyName ?? 'Unknown',
    title: j.title,
    location: (j.locationRestrictions ?? []).join(', ') || 'Worldwide',
    url: j.applicationLink ?? j.url ?? '',
    directUrl: typeof j.applicationLink === 'string' && !/himalayas\.app/i.test(j.applicationLink) ? j.applicationLink : undefined,
    postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : new Date().toISOString(),
    description: stripHtml(j.description ?? j.excerpt ?? ''),
    tags: j.categories ?? [],
    salary: j.minSalary ? `${j.minSalary}-${j.maxSalary} ${j.salaryCurrency ?? ''}`.trim() : undefined,
  }));
}

/* ------------------------------------------------------- We Work Remotely */
async function weworkremotely(): Promise<Job[]> {
  const feeds = [
    'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  ];
  const out: Job[] = [];
  for (const feed of feeds) {
    const xml = await getText(feed);
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const item = m[1];
      const pick = (tag: string) => {
        const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(item);
        if (!r) return '';
        return r[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
      };
      const rawTitle = stripHtml(pick('title'));
      const link = pick('link');
      if (!link) continue;
      // WWR titles look like "Company: Senior Engineer"
      const split = rawTitle.split(':');
      const company = split.length > 1 ? split[0].trim() : 'Unknown';
      const title = split.length > 1 ? split.slice(1).join(':').trim() : rawTitle;
      out.push({
        id: `wwr:${link}`,
        source: 'WeWorkRemotely',
        company,
        title,
        location: stripHtml(pick('region')) || 'Remote',
        url: link,
        postedAt: pick('pubDate') ? new Date(pick('pubDate')).toISOString() : new Date().toISOString(),
        description: stripHtml(pick('description')),
        tags: [],
      });
    }
  }
  return out;
}

/* ------------------------------------------- Company boards: Ashby / Greenhouse / Lever
 * Add companies to watch in watchlist.json. These are the boards that carry the
 * roles aggregators often miss, and applying direct beats applying via a board.
 */
export type Watch = { ats: 'ashby' | 'greenhouse' | 'lever'; token: string; label?: string };

async function ashby(w: Watch): Promise<Job[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${w.token}?includeCompensation=true`);
  return (data.jobs ?? []).map((j: any) => ({
    id: `ashby:${w.token}:${j.id}`,
    source: `Ashby/${w.label ?? w.token}`,
    company: w.label ?? w.token,
    title: j.title,
    location: [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean).join(', ') || 'Remote',
    url: j.jobUrl,
    postedAt: j.publishedAt ?? new Date().toISOString(),
    description: stripHtml(j.descriptionHtml ?? ''),
    tags: [j.department, j.team].filter(Boolean),
    salary: j.compensation?.compensationTierSummary ?? undefined,
  }));
}

async function greenhouse(w: Watch): Promise<Job[]> {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${w.token}/jobs?content=true`);
  return (data.jobs ?? []).map((j: any) => ({
    id: `greenhouse:${w.token}:${j.id}`,
    source: `Greenhouse/${w.label ?? w.token}`,
    company: w.label ?? w.token,
    title: j.title,
    location: j.location?.name ?? 'Remote',
    url: j.absolute_url,
    postedAt: j.updated_at ?? new Date().toISOString(),
    description: stripHtml(j.content ?? ''),
    tags: (j.departments ?? []).map((d: any) => d.name),
  }));
}

async function lever(w: Watch): Promise<Job[]> {
  const rows = await getJson(`https://api.lever.co/v0/postings/${w.token}?mode=json`);
  return (rows ?? []).map((j: any) => ({
    id: `lever:${w.token}:${j.id}`,
    source: `Lever/${w.label ?? w.token}`,
    company: w.label ?? w.token,
    title: j.text,
    location: j.categories?.location ?? 'Remote',
    url: j.hostedUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(),
    description: stripHtml(j.descriptionPlain ?? j.description ?? ''),
    tags: [j.categories?.team, j.categories?.commitment].filter(Boolean),
  }));
}

/* ------------------------------------------------------------------ runner */
const BOARD_CAP = 150;
export async function fetchAll(watchlist: Watch[], log = console.log): Promise<Job[]> {
  const tasks: Array<[string, () => Promise<Job[]>]> = [
    ['RemoteOK', remoteok],
    ['Remotive', remotive],
    ['Himalayas', himalayas],
    ['WeWorkRemotely', weworkremotely],
    ...watchlist.map((w): [string, () => Promise<Job[]>] => [
      `${w.ats}:${w.label ?? w.token}`,
      async () => {
        const rows = await (w.ats === 'ashby' ? ashby(w) : w.ats === 'greenhouse' ? greenhouse(w) : lever(w));
        // staffing agencies post hundreds of roles at once (Bluelight: 917) and
        // would drown everything else: keep the newest slice of any huge board
        return rows
          .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
          .slice(0, BOARD_CAP);
      },
    ]),
  ];

  const all: Job[] = [];
  for (const [name, run] of tasks) {
    try {
      const jobs = await run();
      log(`  ${name}: ${jobs.length}`);
      all.push(...jobs);
    } catch (err: any) {
      log(`  ${name}: FAILED (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 400)); // be a polite client
  }

  // de-duplicate on company + title, keeping the direct company board over an aggregator
  const rank = (j: Job) => (/^(Ashby|Greenhouse|Lever)\//.test(j.source) ? 0 : 1);
  const byKey = new Map<string, Job>();
  for (const j of all.sort((a, b) => rank(a) - rank(b))) {
    const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`;
    if (!byKey.has(key)) byKey.set(key, j);
  }
  return [...byKey.values()];
}
