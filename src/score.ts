/**
 * Eligibility and fit scoring.
 *
 * Eligibility first: most "remote" jobs are remote-within-one-country. Being in
 * India, a US-only role is a waste of an evening however good the stack match is,
 * so it is demoted hard rather than hidden (sometimes they flex for the right person).
 */
import { isBoard, type Job } from './sources.ts';

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

// words in a location field that describe a way of working, not a place
const GENERIC = /\b(remote|remotely|hybrid|on ?site|office|home ?based|based|first|fully|only|anywhere|in the world|worldwide|global|globally|distributed|flexible|wfh|work from home|time ?zones?|hours?|not stated|unknown|any|locations?|multiple|various|jobs?|position|role|team|tbd|other|the)\b/g;

/**
 * The places a location field names, with the ways of working taken out:
 * "Time zone: CET (+/- 3 hours)" names ["cet"], "Remote" names nothing,
 * "London, United Kingdom - Deliveroo" names three things, all of them not India.
 */
export function namedPlaces(location: string): string[] {
  return location.toLowerCase()
    .split(/[;,|/()\n]|\s-\s|\s+or\s+|\s+and\s+|:/)
    .map((s) => s.replace(/[^a-z ]+/g, ' ').replace(GENERIC, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

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
  const parts = namedPlaces(job.location);
  if (!parts.length) return named(job.title.toLowerCase()) ? 'only' : null;
  const inIndia = parts.filter(named).length;
  return inIndia === 0 ? null : inIndia === parts.length ? 'only' : 'among';
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// a sentence that only wishes for the language is not a requirement
const NICE_TO_HAVE = /\b(plus|bonus|nice to have|advantage|advantageous|preferred|optional|desirable|not required)\b/;

/**
 * A language he does not speak, required: "fluent German", "native Japanese
 * speaker", "Mandarin is a must". Read sentence by sentence, so "English
 * required; German is a plus" does not count.
 */
export function languageRequired(text: string, profile: any): string | null {
  const langs: string[] = profile.eligibility.languages ?? [];
  if (!langs.length) return null;
  const L = `(${langs.map(escapeRe).join('|')})`;
  const before = new RegExp(`\\b(fluent|fluency|native|proficien\\w*|business[- ]level|professional[- ]level|working knowledge of|written and spoken|spoken and written|verbal and written|excellent)\\b[^.]{0,40}?\\b${L}\\b`);
  const after = new RegExp(`\\b${L}\\b[^.]{0,25}?\\b(speak\\w*|speaker|language skills|fluency|fluent|required|is a must|must|mandatory|native|proficiency|c1|c2|b2)\\b`);
  const speaking = new RegExp(`\\b${L}[- ]speaking\\b`);
  for (const sentence of text.split(/[.\n;!?]+/)) {
    if (NICE_TO_HAVE.test(sentence)) continue;
    const m = before.exec(sentence) ?? after.exec(sentence) ?? speaking.exec(sentence);
    if (m) return langs.find((l) => new RegExp(`\\b${escapeRe(l)}\\b`).test(m[0])) ?? null;
  }
  return null;
}

/**
 * "Anywhere in China" is not anywhere: whatever follows "anywhere in" decides
 * it. APAC takes in India, a bare Asia is good but not worldwide, an Indian
 * place is India, anything else is somewhere he cannot work from.
 */
function anywhereIn(s: string, profile: any): { eligibility: Eligibility; why: string } | null {
  const m = /\banywhere (?:in|within|across) (?!the world\b)(?:the )?([a-z]+(?: [a-z]+){0,2})/.exec(s);
  if (!m) return null;
  const where = m[1];
  const said = `says "anywhere in ${where}"`;
  if (/\b(apac|asia pacific)\b/.test(where)) return { eligibility: 'worldwide', why: said };
  if (/\basia\b/.test(where)) return { eligibility: 'friendly', why: said };
  const places: string[] = profile.eligibility.indiaPlaces ?? ['india'];
  if (places.some((p) => new RegExp(`\\b${escapeRe(p)}\\b`).test(where))) return { eligibility: 'india', why: said };
  return { eligibility: 'restricted', why: said };
}

export function judgeEligibility(job: Job, profile: any): { eligibility: Eligibility; why: string } {
  const text = `${job.title} \n ${job.location} \n ${job.description}`.toLowerCase();
  // the title carries restrictions as often as the location field does:
  // "Senior Engineer (US-Based/Remote)" is not a worldwide job
  const loc = `${job.location} ${job.title}`.toLowerCase();

  // the application form outranks anything the posting says: a "Remote" job
  // whose form asks for US work authorization hires only in the US
  if (job.formBlock) return { eligibility: 'restricted', why: `application form asks: "${job.formBlock}"` };
  // no location makes up for a language he does not speak
  const lang = languageRequired(text, profile);
  if (lang) return { eligibility: 'restricted', why: `requires ${lang}` };
  // before the "anywhere" phrase below can call it worldwide
  const scoped = anywhereIn(`${job.location}\n${job.title}`.toLowerCase(), profile);
  if (scoped) return scoped;

  for (const phrase of profile.eligibility.great) {
    if (has(loc, phrase)) return { eligibility: 'worldwide', why: `location says "${phrase}"` };
  }
  // checked before the blocked words: "Hyderabad (Hybrid)" is a job he can take,
  // where "London (Hybrid)" is not
  const india = whereInIndia(job, profile);
  if (india === 'only') return { eligibility: 'india', why: 'based in India' };
  if (india === 'among') return { eligibility: 'worldwide', why: 'India is among the listed places' };
  // APAC among the places takes in India, so it is as good as worldwide; a bare
  // Asia is good but not worldwide, since it often means East or Southeast Asia.
  // The title counts only when the location names nothing: "Engineer - Asia"
  // located in China is a job in China.
  const places = namedPlaces(job.location);
  const among = (re: RegExp) => (places.length ? places.some((p) => re.test(p)) : re.test(job.title.toLowerCase()));
  if (among(/\b(apac|asia pacific)\b/)) return { eligibility: 'worldwide', why: 'APAC among the listed places' };
  if (among(/\basia\b/)) return { eligibility: 'friendly', why: 'Asia named, which is not worldwide' };

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

  // any other place in the location is where the job is: London, France, EMEA,
  // "Time zone: CET". None of them is open from India, whatever the description
  // says about EMEA or being distributed.
  if (places.length) return { eligibility: 'restricted', why: `located in ${job.location}` };
  // with nothing in the location, a region in the title scopes it the same way
  const word = (p: string) => new RegExp('\\b' + escapeRe(p.trim()) + '\\b');
  const titled = profile.eligibility.good.find((p: string) => word(p).test(job.title.toLowerCase()));
  if (titled) return { eligibility: 'restricted', why: `title names ${titled.trim()}` };

  // "work from anywhere in the EU" in a description scopes it just the same
  const scopedText = anywhereIn(text, profile);
  if (scopedText) return scopedText;

  // a bare "global" or "anywhere" in a description usually describes the company,
  // not where it hires: only unambiguous phrases count here
  for (const phrase of profile.eligibility.greatInText ?? []) {
    if (has(text, phrase)) return { eligibility: 'worldwide', why: `description says "${phrase}"` };
  }
  if (hardBlocks.length) return { eligibility: 'restricted', why: `description says "${hardBlocks[0]}"` };
  // whole words only: "facets" is not a CET time zone
  for (const phrase of profile.eligibility.good) {
    if (word(phrase).test(text)) return { eligibility: 'friendly', why: `mentions ${phrase.trim()}` };
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

/**
 * The top of the USD pay range a posting states, in its salary field or its
 * text: "$150,000", "$150k", or a salary field of plain numbers with no other
 * currency. Amounts under $20k are left out, being hourly or monthly figures.
 */
export function statedPayUSD(job: { salary?: string; description: string }): number | null {
  const amounts: number[] = [];
  const text = `${job.salary ?? ''} \n ${job.description}`;
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?k\b|\d{5,7}\b)/gi)) {
    const raw = m[1].toLowerCase().replace(/,/g, '');
    amounts.push(raw.endsWith('k') ? parseFloat(raw) * 1000 : Number(raw));
  }
  if (job.salary && !/\b(eur|gbp|inr|cad|aud|chf|sek|nok|dkk|pln|brl|mxn|jpy|sgd)\b|[^\x00-\x7F]/i.test(job.salary)) {
    for (const m of job.salary.matchAll(/\d{5,7}/g)) amounts.push(Number(m[0]));
  }
  const annual = amounts.filter((a) => a >= 20_000 && a <= 1_000_000);
  return annual.length ? Math.max(...annual) : null;
}

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

  // freshness: a month-old remote posting is usually gone. Not on sources that
  // drop a listing when it closes: there an old date means a role kept open
  // (Sticker Mule has posted the same one since May), not a stale page.
  const ageDays = (Date.now() - new Date(job.postedAt).getTime()) / 86_400_000;
  const liveOnly = isBoard(job.source) || job.source === 'WeWorkRemotely';
  if (ageDays <= 3) { points += 6; reasons.push('posted in the last 3 days'); }
  else if (ageDays <= 10) points += 3;
  else if (ageDays > 45 && !liveOnly) { points -= 6; reasons.push('posting is over 45 days old'); }

  // salary transparency is a decent proxy for a serious, global employer, and
  // pay at or above his target is a reason to apply in its own right
  const pay = statedPayUSD(job);
  if (job.salary || pay) points += 2;
  if (pay && pay >= (profile.pay?.targetUSD ?? Infinity)) {
    points += 8; reasons.push(`pays up to $${Math.round(pay / 1000)}k`);
  }

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
