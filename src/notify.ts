/**
 * The morning notification, via ntfy.
 *
 * ntfy needs no account: the phone app subscribes to a topic, and anything
 * posted to that topic arrives as a notification. Tapping it opens the report.
 * The topic is the only secret - anyone who knows it can read it - so it is
 * random, and it is redacted from anything that reaches a log.
 */
import { writeFileSync } from 'node:fs';
import type { Scored } from './score.ts';

const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '');

/**
 * Every line of the digest means something - the last is the report link - so
 * a company or title arriving with a newline could forge a line and put its own
 * link under a trustworthy label. Job text is third-party and some of it is
 * scraped, so it is flattened to one line first.
 */
const oneLine = (s: string, max = 90) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// characters a phone ignores when deciding what is a link, so stripping them
// AFTER link detection would let "ht*tps://evil.com/x" reassemble into one
const INVISIBLE = new RegExp('[\\u00ad\\u200b-\\u200f\\u2060\\ufeff]', 'g');
const EMPHASIS = /[*_~`]/g;
// dots a browser accepts as a domain separator that a plain \. misses
const DOT_LOOKALIKES = new RegExp('[\\u3002\\uff61\\u2024\\u2027]', 'g');
// extensions that look like a domain but are how engineers write a stack:
// Node.js/React and ASP.NET must survive a job title untouched
const NOT_A_TLD = 'js|ts|jsx|tsx|mjs|py|rb|go|php|net|sql|md|css|html|json|yml|sh';
const DOMAIN_WITH_PATH = new RegExp(`[\\p{L}\\p{N}-]+\\.(?!(?:${NOT_A_TLD})\\b)[\\p{L}]{2,24}/\\S*`, 'giu');

/**
 * The only links in a digest should be the ones this tool put there. Phones
 * linkify a URL anywhere in a notification, so links in third-party fields are
 * removed - including shorteners, other schemes, bare IPs, fullwidth and
 * lookalike-dot spellings, and Cyrillic or Greek homograph domains.
 */
const safeField = (s: string, max = 90) =>
  oneLine(s, max * 2)
    .normalize('NFKC')                  // folds fullwidth letters to plain ones
    .replace(DOT_LOOKALIKES, '.')
    .replace(INVISIBLE, '')
    .replace(EMPHASIS, '')
    .replace(/\b[a-z][a-z0-9+.-]{1,10}:\/\/\S+/gi, '[link]')       // any scheme
    .replace(/(https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(DOMAIN_WITH_PATH, '[link]')                              // bit.ly/x and friends
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?:[:/]\S*)?/g, '[link]')    // bare IPv4
    .trim()
    .slice(0, max);

/** A digest that reads like a note from someone who looked, not a dump. */
export function buildDigest(jobs: Scored[], newIds: Set<string>, profile: any, max = 5): string {
  const byNewest = (a: Scored, b: Scored) => +new Date(b.postedAt) - +new Date(a.postedAt);
  const strong = jobs.filter((j) => j.score >= profile.thresholds.strong).sort(byNewest);
  const worth = jobs
    .filter((j) => j.score >= profile.thresholds.worthALook && j.score < profile.thresholds.strong)
    .sort(byNewest);

  const pick = [...strong, ...worth].slice(0, max);
  if (!pick.length) return '';

  const freshCount = pick.filter((j) => newIds.has(j.id)).length;
  const lines = [
    `${strong.length} strong, ${worth.length} worth a look${freshCount ? `, ${freshCount} new` : ''}`,
    '',
  ];
  for (const j of pick) {
    const age = Math.round((Date.now() - +new Date(j.postedAt)) / 86_400_000);
    lines.push(`${safeField(j.company, 40)} - ${safeField(j.title)}`);
    lines.push(`${j.score}/100 - ${safeField(j.location || 'Remote', 40)} - ${age <= 0 ? 'today' : age + 'd ago'}`);
    lines.push(oneLine(short(j.directUrl ?? j.url), 160));
    lines.push('');
  }
  lines.push(process.env.JOBSCOUT_REPORT_URL
    ? 'Tap to open the full list and prep packs.'
    : 'Full list in out/report.html, prep packs in drafts/');
  return lines.join('\n');
}

/** The topic and the keyed report URL must never reach a log, even inside an error. */
function redact(s: string, topic?: string): string {
  let out = s;
  for (const v of [topic, process.env.JOBSCOUT_REPORT_URL]) if (v) out = out.split(v).join('[redacted]');
  return out;
}

export async function notify(text: string, topic: string | undefined, digestPath: string, log = console.log): Promise<void> {
  if (!text) { log('  nothing new worth a notification'); return; }
  const inCI = Boolean(process.env.CI);

  if (!topic) {
    if (inCI) { log('  NTFY_TOPIC is not set - no notification sent'); return; }
    writeFileSync(digestPath, text, 'utf8');
    log(`  no ntfy topic configured - digest written to ${digestPath}`);
    return;
  }

  try {
    const report = process.env.JOBSCOUT_REPORT_URL;
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { title: 'Job scout', tags: 'briefcase', ...(report ? { click: report } : {}) },
      body: text,
    });
    if (!res.ok) throw new Error(`ntfy ${res.status}: ${(await res.text()).slice(0, 120)}`);
    log('  sent via ntfy');
  } catch (err: any) {
    // a failed notification must never fail the run: the report is already stored
    log(`  notification failed (${redact(err.message, topic)})`);
  }
}
