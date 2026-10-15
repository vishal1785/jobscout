/**
 * Eligibility and fit scoring.
 *
 * Eligibility first: most "remote" jobs are remote-within-one-country. Being in
 * India, a US-only role is a waste of an evening however good the stack match is,
 * so it is demoted hard rather than hidden (sometimes they flex for the right person).
 */
import type { Job } from './sources.ts';

// 'india' is a job based in India: open to him whether it is remote, hybrid or
// in an office, and listed in its own section rather than among worldwide roles
export type Eligibility = 'worldwide' | 'india' | 'friendly' | 'unclear' | 'restricted';

export type Scored = Job & {
  score: number;
  directUrl?: string;
  eligibility: Eligibility;
  eligibilityWhy: string;
  matched: string[];
  gaps: string[];
  reasons: string[];
};

const has = (hay: string, needle: string) => hay.includes(needle);

// words in a location field that name a way of working, not a place
const MODE_WORDS = /\b(remote|hybrid|on-?site|in-?office|office|home[- ]based|based|fully|only|anywhere in|wfh)\b/g;

/**
 * Whether a job is in India: 'only' when every place it names is in India
 * ("Hybrid - India", "Bengaluru, Chennai"), 'among' when India is one of
 * several countries ("Remote: Japan, Spain, India"), which is a remote role
 * open to him rather than an Indian one. The title counts only when the
 * location names no place at all ("Senior Engineer (India)", location "Remote").
 */
export function whereInIndia(job: { title: string; location: string }, profile: any): 'only' | 'among' | null {
  const places: string[] = profile.eligibility.indiaPlaces ?? ['india'];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = (s: string) => places.some((p) => new RegExp('\\b' + escape(p) + '\\b').test(s));
  const parts = job.location.toLowerCase()
    .split(/[;,|/()\n]|\s-\s|\s+or\s+|\s+and\s+|:/)
    .map((s) => s.replace(MODE_WORDS, ' ').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!parts.length) return named(job.title.toLowerCase()) ? 'only' : null;
  const inIndia = parts.filter(named).length;
  return inIndia === 0 ? null : inIndia === parts.length ? 'only' : 'among';
}

export function judgeEligibility(job: Job, profile: any): { eligibility: Eligibility; why: string } {
  const text = `${job.title} \n ${job.location} \n ${job.description}`.toLowerCase();
  // the title carries restrictions as often as the location field does:
  // "Senior Engineer (US-Based/Remote)" is not a worldwide job
  const loc = `${job.location} ${job.title}`.toLowerCase();

  // the application form outranks anything the posting says: a "Remote" job
  // whose form asks for US work authorization hires only in the US
  if (job.formBlock) return { eligibility: 'restricted', why: `application form asks: "${job.formBlock}"` };

  for (const phrase of profile.eligibility.great) {
    if (has(loc, phrase)) return { eligibility: 'worldwide', why: `location says "${phrase}"` };
  }
  // checked before the blocked words: "Hyderabad (Hybrid)" is a job he can take,
  // where "London (Hybrid)" is not
  const india = whereInIndia(job, profile);
  if (india === 'only') return { eligibility: 'india', why: 'based in India' };
  if (india === 'among') return { eligibility: 'worldwide', why: 'India is among the listed places' };
  // Asia named explicitly is as good as worldwide for him
  if (/\basia\b|\bapac\b/.test(loc)) return { eligibility: 'worldwide', why: 'Asia named in location' };

  const hardBlocks = profile.eligibility.bad.filter((p: string) => has(text, p));
  const locBlocks = profile.eligibility.bad.filter((p: string) => has(loc, p));
  if (locBlocks.length) return { eligibility: 'restricted', why: `location says "${locBlocks[0]}"` };

  // "<somewhere> Only" in the title or location, where somewhere is not his part
  // of the world: "Senior Engineer - Mexico Only" is not a job he can take
  const elsewhere = (profile.eligibility.notMine ?? []).find((r: string) => has(loc, r));
  if (elsewhere) return { eligibility: 'restricted', why: `hiring in ${elsewhere}` };
  if (/\bonly\b/.test(loc)) return { eligibility: 'restricted', why: `location says "only": ${job.location}` };
  // "Remote - US", "Remote - NYC": a bare country or city scope in the location
  // field is a restriction, whatever the description claims about being global
  if (/\b(us|usa|u\.s\.?|nyc|new york|sf|bay area)\b/.test(loc)) {
    return { eligibility: 'restricted', why: `location is country-scoped: ${job.location}` };
  }

  // a bare "global" or "anywhere" in a description usually describes the company,
  // not where it hires: only unambiguous phrases count here
  for (const phrase of profile.eligibility.greatInText ?? []) {
    if (has(text, phrase)) return { eligibility: 'worldwide', why: `description says "${phrase}"` };
  }
  for (const phrase of profile.eligibility.good) {
    if (has(loc, phrase)) return { eligibility: 'friendly', why: `region: ${job.location}` };
  }
  if (hardBlocks.length) return { eligibility: 'restricted', why: `description says "${hardBlocks[0]}"` };
  for (const phrase of profile.eligibility.good) {
    if (has(text, phrase)) return { eligibility: 'friendly', why: `mentions ${phrase.trim()}` };
  }
  return { eligibility: 'unclear', why: `location: ${job.location || 'not stated'}` };
}

const ELIGIBILITY_FACTOR: Record<Eligibility, number> = {
  worldwide: 1,
  india: 1,
  friendly: 0.85,
  unclear: 0.6,
  restricted: 0.18,
};

export function scoreJob(job: Job, profile: any): Scored {
  const title = job.title.toLowerCase();
  const text = `${title} \n ${job.tags.join(' ')} \n ${job.description}`.toLowerCase();
  const reasons: string[] = [];
  const matched: string[] = [];
  const gaps: string[] = [];

  // hard rejects on title
  const rejected = profile.titles.reject.find((r: string) => title.includes(r));

  let points = 0;

  // is this even an engineering role he'd want
  const titleHit = profile.titles.wanted.some((t: string) => title.includes(t));
  if (titleHit) { points += 12; reasons.push('engineering title'); }

  const seniority = profile.titles.seniorityBonus.find((s: string) => title.includes(s));
  if (seniority) { points += 10; reasons.push(`seniority: ${seniority}`); }

  // junior-level asks are a mismatch for 19 years
  if (/\b([1-4])\+? years\b/.test(text) && !/\b([7-9]|1[0-9])\+? years\b/.test(text)) {
    points -= 8; reasons.push('asks for few years of experience');
  }
  if (/\b(8|9|10|12|15)\+? years\b/.test(text)) { points += 6; reasons.push('wants deep experience'); }

  // stack match
  for (const [kw, weight] of Object.entries<number>(profile.skills.core)) {
    if (text.includes(kw)) { points += weight; matched.push(kw); }
  }
  for (const [kw, weight] of Object.entries<number>(profile.skills.differentiators)) {
    if (text.includes(kw)) { points += weight; matched.push(kw); }
  }
  // gaps: penalise only when the gap looks central (title or first part of the text)
  const head = `${title} \n ${job.description.slice(0, 600).toLowerCase()}`;
  for (const [kw, weight] of Object.entries<number>(profile.skills.gaps)) {
    if (text.includes(kw)) {
      gaps.push(kw);
      // in the title the gap IS the job ("Full Stack Java Engineer"); early in the
      // description it is a core requirement; further down it is a nice-to-have
      if (title.includes(kw)) points -= weight * 2.5;
      else if (head.includes(kw)) points -= weight;
      else points -= Math.ceil(weight / 3);
    }
  }

  // freshness: a month-old remote posting is usually gone
  const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / 86_400_000;
  if (ageDays <= 3) { points += 6; reasons.push('posted in the last 3 days'); }
  else if (ageDays <= 10) points += 3;
  else if (ageDays > 45) { points -= 6; reasons.push('posting is over 45 days old'); }

  // salary transparency is a decent proxy for a serious, global employer
  if (job.salary) points += 2;

  const { eligibility, why } = judgeEligibility(job, profile);
  const raw = Math.max(0, Math.min(100, points));
  // a US work-authorization question on the form is skipped, not demoted:
  // there is no flexing on that one
  const score = rejected || job.formBlock ? 0 : Math.round(raw * ELIGIBILITY_FACTOR[eligibility]);

  if (rejected) reasons.unshift(`rejected: title contains "${rejected}"`);
  else if (job.formBlock) reasons.unshift('skipped: the application form asks for US work authorization');
  reasons.push(`eligibility: ${eligibility} (${why})`);

  return {
    ...job,
    score,
    eligibility,
    eligibilityWhy: why,
    matched: [...new Set(matched)],
    gaps: [...new Set(gaps)],
    reasons,
  };
}

export function scoreAll(jobs: Job[], profile: any): Scored[] {
  return jobs.map((j) => scoreJob(j, profile)).sort((a, b) => b.score - a.score);
}
