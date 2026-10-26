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
  formBlock?: string;    // a question on its application form that rules him out
  formQuestions?: string[]; // every question its application form asks, when it could be read
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
// The plain API returns only the newest ~100 jobs across every category. Each
// tag returns its own newest 100, so a few engineering tags reach ~500 unique
// jobs, weeks deeper. ("fullstack" and "frontend" return nothing there.)
const REMOTEOK_TAGS = ['', 'dev', 'engineer', 'javascript', 'react', 'typescript', 'python', 'node', 'backend', 'senior', 'aws'];
async function remoteok(): Promise<Job[]> {
  const byId = new Map<string, any>();
  for (const tag of REMOTEOK_TAGS) {
    const rows = await getJson(`https://remoteok.com/api${tag ? `?tag=${tag}` : ''}`);
    for (const r of rows ?? []) if (r?.id && r?.position) byId.set(String(r.id), r);
    await new Promise((res) => setTimeout(res, 800));      // their API asks for a gentle pace
  }
  return [...byId.values()]
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
// Himalayas lists 120,000+ jobs, and its plain feed's newest 200 cover about
// one day. Its search takes country=India, which returns only roles open to
// someone in India (worldwide ones and those that list India), so a few
// engineering searches, newest first, reach weeks back instead of hours.
const HIMALAYAS_QUERIES = ['software engineer', 'developer', 'full stack', 'frontend', 'backend', 'react', 'tech lead', 'ai engineer'];
async function himalayas(): Promise<Job[]> {
  const rows = new Map<string, any>();
  for (const q of HIMALAYAS_QUERIES) {
    for (let page = 1; page <= 4; page++) {
      const data = await getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&country=India&sort=recent&page=${page}`);
      const batch = data.jobs ?? [];
      for (const j of batch) rows.set(j.guid ?? j.applicationLink, j);
      await new Promise((r) => setTimeout(r, 250));
      if (batch.length < 20) break;
    }
  }
  return [...rows.values()].map((j: any) => ({
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
  // back-end and front-end mostly repeat the programming feed, but not
  // entirely; devops is where the cloud and AWS roles are
  const feeds = [
    'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
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
        // the feed escapes its HTML: one pass decodes it, a second strips the tags
        description: stripHtml(stripHtml(pick('description'))),
        tags: [],
      });
    }
  }
  return out;
}

/* ------------------------------------------------- Hacker News: Who is hiring?
 * A monthly thread where companies, often founders, post their own roles. Free
 * and keyless through HN's Algolia API: one request returns the whole thread.
 * Most posts open with "Company | Role | Location | Type | Salary | link";
 * some use "Company:" and "Location:" lines instead. Posts with neither shape
 * are skipped rather than guessed at.
 */
const decodeEntities = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));

const LOCATION_PART = /\b(remote|onsite|on-site|in-office|office|hybrid|worldwide|anywhere|global|relocation|timezone|time zone|utc|gmt|est|pst|cet)\b|,\s*[A-Z]{2}\b|\b(london|berlin|new york|nyc|sf|san francisco|bay area|india|europe|eu|uk|us|usa|canada|germany|toronto|amsterdam|paris|singapore|sydney|bangalore|bengaluru|pune|apac|emea|latam)\b/i;
const ROLE_PART = /engineer|developer|architect|lead|cto|full[- ]?stack|front[- ]?end|back[- ]?end|scientist|sre|devops|programmer|founding/i;
// fields are split on "|", or on em and en dashes, which some posts use
// instead; built from char codes so the source stays ASCII
const HN_SEP = new RegExp(`\\s*(?:\\||\\s${String.fromCharCode(0x2014)}\\s|\\s${String.fromCharCode(0x2013)}\\s)\\s*`);

export function parseHnPost(html: string): { company: string; title: string; location: string; link?: string; text: string } | null {
  // the post's first link that leaves HN is usually its careers page or the role itself
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeEntities(m[1].replace(/&amp;/g, '&')))
    .filter((u) => /^https?:\/\//i.test(u) && !/news\.ycombinator\.com/i.test(u));
  const ats = links.find((u) => /ashbyhq|greenhouse|lever\.co|smartrecruiters|workable|recruitee|teamtailor/i.test(u));
  const text = decodeEntities(stripHtml(html.replace(/<p>/g, '\n')));
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const field = (name: RegExp) => lines.slice(0, 8).map((l) => name.exec(l)?.[1]?.trim()).find(Boolean);
  const keyed = { company: field(/^company\s*:\s*(.+)$/i), title: field(/^(?:role|position|title|job)s?\s*:\s*(.+)$/i), location: field(/^location\s*:\s*(.+)$/i) };

  const parts = lines[0].split(HN_SEP).map((s) => s.trim()).filter(Boolean);
  let company = keyed.company;
  let title = keyed.title;
  let location = keyed.location;
  if (parts.length >= 2) {
    company ??= parts[0];
    title ??= parts.slice(1).find((s) => ROLE_PART.test(s) && !LOCATION_PART.test(s)) ?? parts.slice(1).find((s) => ROLE_PART.test(s));
    location ??= parts.slice(1).filter((s) => s !== title && LOCATION_PART.test(s) && !/^https?:/i.test(s)).join('; ');
  }
  if (!company || !title) return null;
  // "Snout https://snout.com/" and "Smarkets ( https://... )": the name only
  company = company.replace(/\(?\s*https?:\/\/\S+\s*\)?/g, '').trim() || company;
  return { company: company.slice(0, 80), title: title.slice(0, 140), location: location || 'Not stated', link: ats ?? links[0], text };
}

async function hackernews(): Promise<Job[]> {
  const threads = (await getJson('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10')).hits
    .filter((h: any) => /who is hiring/i.test(h.title))
    .slice(0, 2);
  if (!threads.length) return [];
  // early in a month the new thread is still filling up, so read last month's too
  const fresh = Date.now() - Date.parse(threads[0].created_at) < 10 * 86_400_000;
  const out: Job[] = [];
  for (const t of fresh ? threads : threads.slice(0, 1)) {
    const item = await getJson(`https://hn.algolia.com/api/v1/items/${t.objectID}`);
    for (const c of item.children ?? []) {
      if (!c?.text) continue;
      const post = parseHnPost(c.text);
      if (!post) continue;
      out.push({
        id: `hn:${c.id}`,
        source: 'HackerNews',
        company: post.company,
        title: post.title,
        location: post.location,
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        directUrl: post.link,
        postedAt: c.created_at ?? new Date().toISOString(),
        description: post.text,
        tags: [],
      });
    }
  }
  return out;
}

/* ----------------------------------------------------------------- Jobicy */
async function jobicy(): Promise<Job[]> {
  const out: Job[] = [];
  // their geo=anywhere feed holds only a handful of roles, so pull the whole
  // dev industry and let the eligibility scoring sort out the geography
  let cursor = '';
  for (let page = 0; page < 4; page++) {
    const url = `https://jobicy.com/api/v2/remote-jobs?count=50&industry=dev${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await getJson(url);
    for (const r of res.jobs ?? []) {
      out.push({
        id: `jobicy:${r.id}`,
        source: 'Jobicy',
        company: r.companyName ?? 'Unknown',
        title: r.jobTitle ?? '',
        location: r.jobGeo || 'Anywhere',
        url: r.url,
        postedAt: r.pubDate ?? new Date().toISOString(),
        description: stripHtml(r.jobDescription || r.jobExcerpt || ''),
        tags: [...(r.jobIndustry ?? []), ...(r.jobType ?? []), r.jobLevel].filter(Boolean),
      });
    }
    if (!res.hasMore || !res.nextCursor) break;
    cursor = res.nextCursor;
    await new Promise((r) => setTimeout(r, 300));
  }
  return out.filter((j) => j.title);
}

/* ---------------------------------------------------------- WorkingNomads */
async function workingnomads(): Promise<Job[]> {
  const rows = await getJson('https://www.workingnomads.com/api/exposed_jobs/');
  return (rows ?? [])
    .filter((r: any) => r?.title && r?.url)
    .map((r: any) => ({
      id: `workingnomads:${r.url.replace(/\D+/g, '') || r.title}`,
      source: 'WorkingNomads',
      company: r.company_name ?? 'Unknown',
      title: r.title,
      // their location field often carries the real restriction ("Time zone: CET")
      location: r.location || 'Remote',
      url: r.url,
      postedAt: r.pub_date ?? new Date().toISOString(),
      description: stripHtml(r.description ?? ''),
      tags: String(r.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean)
        .concat(r.category_name ? [r.category_name] : []),
    }));
}

/* ------------------------------------------------- RealWorkFromAnywhere */
// No API: the home page is server-rendered and lists the newest ~280 roles,
// every one of them genuinely open worldwide, which is exactly his filter.
// The sitemap carries the posting dates, so the two are read together.
async function realworkfromanywhere(): Promise<Job[]> {
  const host = 'https://www.realworkfromanywhere.com';
  const [html, sitemap] = await Promise.all([getText(host + '/'), getText(host + '/sitemap.xml').catch(() => '')]);

  const dates = new Map<string, string>();
  for (const m of sitemap.matchAll(/<loc>[^<]*\/jobs\/([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    dates.set(m[1], m[2]);
  }

  const out: Job[] = [];
  // the <li> gained classes in Oct 2026 and the scraper silently found nothing,
  // so it now accepts any attributes there
  const seen = new Set<string>();
  for (const card of html.matchAll(/<li[^>]*><a href="\/jobs\/([^"]+)"[\s\S]*?<\/a><\/li>/g)) {
    if (seen.has(card[1])) continue;          // the page repeats some cards in more than one list
    seen.add(card[1]);
    const [block, slug] = [card[0], card[1]];
    const title = decode(block.match(/<h3[^>]*>([^<]+)<\/h3>/)?.[1]);
    const company = decode(block.match(/<p class="text-base truncate[^"]*"[^>]*>([^<]+)<\/p>/)?.[1])
      || decode(block.match(/alt="([^"]+?) logo"/)?.[1]);
    if (!title || !company) continue;
    const location = block.match(/<span class="truncate"><span>([^<]+)<\/span>/)?.[1]?.trim() || 'Anywhere in the World';
    const tags = [...block.matchAll(/<span class="badge[^"]*">\s*([^<]+?)\s*<\/span>/g)].map((t) => t[1]);
    const ago = block.match(/>(\d+) (day|days|hour|hours|month|months) ago</);
    out.push({
      id: `rwfa:${slug}`,
      source: 'RealWorkFromAnywhere',
      company,
      title,
      location,
      url: `${host}/jobs/${slug}`,
      postedAt: dates.get(slug) ?? agoToIso(ago?.[1], ago?.[2]),
      description: '',           // card view only; the title and tags carry the signal
      tags,
    });
  }
  return out;
}

const decode = (s?: string) => stripHtml(s ?? "");

function agoToIso(n?: string, unit?: string): string {
  const days = !n ? 0 : Number(n) * (unit?.startsWith('hour') ? 1 / 24 : unit?.startsWith('month') ? 30 : 1);
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/* -------------------------- Company boards: Ashby / Greenhouse / Lever / SmartRecruiters
 * The companies to watch are listed in companies.json. These are the boards that
 * carry the roles aggregators often miss, and applying direct beats applying via
 * a board. Lever runs a separate EU instance, which some companies (Lever itself)
 * are hosted on, hence 'lever-eu'.
 */
export type Watch = { ats: 'ashby' | 'greenhouse' | 'lever' | 'lever-eu' | 'smartrecruiters'; token: string; label?: string };

/** A job that came straight from a company's own board, not an aggregator. */
export const isBoard = (source: string) => /^(Ashby|Greenhouse|Lever|SmartRecruiters)\//.test(source);

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
  const rows = await getJson(`https://api${w.ats === 'lever-eu' ? '.eu' : ''}.lever.co/v0/postings/${w.token}?mode=json`);
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

// The list carries no description, and each posting's description is a request
// of its own, so only the newest engineering-looking titles are read in full.
// The rest still score on title and location, which is enough to rule them out.
const ENGINEERING = /engineer|developer|architect|full[- ]?stack|front[- ]?end|back[- ]?end|\bcto\b|tech(nical)? lead/i;
async function smartrecruiters(w: Watch): Promise<Job[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(w.token)}/postings`;
  const rows: any[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await getJson(`${base}?limit=100&offset=${offset}`);
    rows.push(...(page.content ?? []));
    if (rows.length >= (page.totalFound ?? 0) || !(page.content ?? []).length) break;
  }
  rows.sort((a, b) => new Date(b.releasedDate).getTime() - new Date(a.releasedDate).getTime());

  const details = new Map<string, any>();
  for (const r of rows.filter((r) => ENGINEERING.test(r.name ?? '')).slice(0, 40)) {
    try { details.set(r.id, await getJson(`${base}/${encodeURIComponent(r.id)}`)); } catch { /* list data is enough */ }
    await new Promise((res) => setTimeout(res, 150));
  }

  return rows.filter((r) => r?.id && r?.name).map((r) => {
    const d = details.get(r.id);
    const sections = d?.jobAd?.sections ?? {};
    const loc = r.location ?? {};
    // the remote and hybrid flags are the real eligibility signal here: Wise
    // lists most roles as hybrid in one city, and "hybrid" is a blocked word
    const where = String(loc.fullLocation ?? [loc.city, loc.country].filter(Boolean).join(', '))
      .replace(/(,\s*)+/g, ', ').replace(/^, |, $/g, '');
    const mode = loc.remote ? 'Remote' : loc.hybrid ? 'Hybrid' : 'On-site';
    return {
      id: `smartrecruiters:${w.token}:${r.id}`,
      source: `SmartRecruiters/${w.label ?? w.token}`,
      company: w.label ?? r.company?.name ?? w.token,
      title: r.name,
      location: `${where || 'Not stated'} (${mode})`,
      url: d?.postingUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(r.company?.identifier ?? w.token)}/${encodeURIComponent(r.id)}`,
      postedAt: r.releasedDate ?? new Date().toISOString(),
      description: stripHtml(['jobDescription', 'qualifications', 'additionalInformation'].map((k) => sections[k]?.text ?? '').join('\n')),
      tags: [r.function?.label, r.experienceLevel?.label].filter(Boolean),
    };
  });
}

/* ------------------------------------------------------------------ runner */
const BOARD_CAP = 150;
export async function fetchBoard(w: Watch): Promise<Job[]> {
  const rows = await (w.ats === 'ashby' ? ashby(w)
    : w.ats === 'greenhouse' ? greenhouse(w)
    : w.ats === 'smartrecruiters' ? smartrecruiters(w)
    : lever(w));
  // staffing agencies post hundreds of roles at once (Bluelight: 917) and
  // would drown everything else: keep the newest slice of any huge board
  return rows
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime())
    .slice(0, BOARD_CAP);
}

/** How each source did on a run, so a scraper that quietly breaks shows up in the report. */
export type SourceHealth = { name: string; count: number; error?: string; board: boolean };

export async function fetchAll(watchlist: Watch[], log = console.log, health: SourceHealth[] = []): Promise<Job[]> {
  const tasks: Array<[string, () => Promise<Job[]>]> = [
    ['RemoteOK', remoteok],
    ['Remotive', remotive],
    ['Himalayas', himalayas],
    ['WeWorkRemotely', weworkremotely],
    ['Jobicy', jobicy],
    ['WorkingNomads', workingnomads],
    ['RealWorkFromAnywhere', realworkfromanywhere],
    ['HackerNews', hackernews],
    ...watchlist.map((w): [string, () => Promise<Job[]>] => [`${w.ats}:${w.label ?? w.token}`, () => fetchBoard(w)]),
  ];

  const all: Job[] = [];
  for (const [name, run] of tasks) {
    const board = name.includes(':');          // board tasks are named ats:company
    try {
      const jobs = await run();
      log(`  ${name}: ${jobs.length}`);
      all.push(...jobs);
      health.push({ name, count: jobs.length, board });
    } catch (err: any) {
      log(`  ${name}: FAILED (${err.message})`);
      health.push({ name, count: 0, error: String(err.message).slice(0, 80), board });
    }
    await new Promise((r) => setTimeout(r, 400)); // be a polite client
  }

  // links come from third parties, one of them scraped: anything that is not a
  // plain http(s) URL is dropped here rather than relied on being escaped later
  const http = (u?: string) => !!u && /^https?:\/\//i.test(u);
  const linked = all.filter((j) => http(j.url));
  for (const j of linked) if (!http(j.directUrl)) j.directUrl = undefined;

  // de-duplicate on company + title, keeping the direct company board over an aggregator
  const rank = (j: Job) => (isBoard(j.source) ? 0 : 1);
  const byKey = new Map<string, Job>();
  for (const j of linked.sort((a, b) => rank(a) - rank(b))) {
    const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`;
    if (!byKey.has(key)) byKey.set(key, j);
  }
  return [...byKey.values()];
}
