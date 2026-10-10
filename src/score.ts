/**
 * Eligibility and fit scoring.
 *
 * Eligibility first: most "remote" jobs are remote-within-one-country. Being in
 * India, a US-only role is a waste of an evening however good the stack match is,
 * so it is demoted hard rather than hidden (sometimes they flex for the right person).
 */
import type { Job } from './sources.ts';

export type Eligibility = 'worldwide' | 'friendly' | 'unclear' | 'restricted';

export type Scored = Job & {
  score: number;
  eligibility: Eligibility;
  eligibilityWhy: string;
  matched: string[];
  gaps: string[];
  reasons: string[];
};

const has = (hay: string, needle: string) => hay.includes(needle);

export function judgeEligibility(job: Job, profile: any): { eligibility: Eligibility; why: string } {
  const text = `${job.title} \n ${job.location} \n ${job.description}`.toLowerCase();
  // the title carries restrictions as often as the location field does:
  // "Senior Engineer (US-Based/Remote)" is not a worldwide job
  const loc = `${job.location} ${job.title}`.toLowerCase();

  for (const phrase of profile.eligibility.great) {
    if (has(loc, phrase)) return { eligibility: 'worldwide', why: `location says "${phrase}"` };
  }
  // India or Asia named explicitly is as good as worldwide for him
  if (/\bindia\b|\basia\b|\bapac\b/.test(loc)) return { eligibility: 'worldwide', why: 'India or Asia named in location' };

  const hardBlocks = profile.eligibility.bad.filter((p: string) => has(text, p));
  const locBlocks = profile.eligibility.bad.filter((p: string) => has(loc, p));
  if (locBlocks.length) return { eligibility: 'restricted', why: `location says "${locBlocks[0]}"` };

  for (const phrase of profile.eligibility.great) {
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
  const score = rejected ? 0 : Math.round(raw * ELIGIBILITY_FACTOR[eligibility]);

  if (rejected) reasons.unshift(`rejected: title contains "${rejected}"`);
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
