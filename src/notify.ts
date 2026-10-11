/**
 * WhatsApp delivery.
 *
 * The report only helps if you actually look at it, so the run ends by sending
 * a short digest to your own WhatsApp. Two transports, both optional:
 *
 *   callmebot  free, no business account. Message "I allow callmebot to send me
 *              messages" to +34 644 51 95 23 on WhatsApp, and it replies with an
 *              API key. Only sends to your own number, which is all this needs.
 *   twilio     for when you want delivery receipts or a second recipient.
 *
 * With neither configured nothing is sent and the digest is written to
 * out/whatsapp.txt, with a wa.me link printed so one click still shares it.
 */
import { writeFileSync } from 'node:fs';
import type { Scored } from './score.ts';

export type WhatsAppConfig = {
  transport?: 'callmebot' | 'twilio' | 'none';
  phone?: string;          // your number in international form, e.g. +919552565520
  apikey?: string;         // callmebot
  accountSid?: string;     // twilio
  authToken?: string;      // twilio
  from?: string;           // twilio sandbox number, e.g. +14155238886
  maxJobs?: number;
};

const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '');

/** A digest that reads like a note from a person who looked, not a dump. */
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
    `*Job scout* ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
    `${strong.length} strong, ${worth.length} worth a look${freshCount ? `, ${freshCount} new` : ''}`,
    '',
  ];

  for (const j of pick) {
    const age = Math.round((Date.now() - +new Date(j.postedAt)) / 86_400_000);
    lines.push(`*${j.company}* - ${j.title}`);
    lines.push(`${j.score}/100 - ${j.location || 'Remote'} - ${age <= 0 ? 'today' : age + 'd ago'}`);
    lines.push(short(j.directUrl ?? j.url));
    lines.push('');
  }
  lines.push('Prep packs are in drafts/, full list in out/report.html');
  return lines.join('\n');
}

async function sendCallMeBot(text: string, c: WhatsAppConfig): Promise<void> {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(c.phone!)}`
    + `&apikey=${encodeURIComponent(c.apikey!)}&text=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const body = await res.text();
  // they answer 200 with an HTML page even on failure, so the body is the real signal
  if (!res.ok || /error|invalid|not allowed/i.test(body)) {
    throw new Error(`callmebot refused: ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  }
}

async function sendTwilio(text: string, c: WhatsAppConfig): Promise<void> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: `whatsapp:${c.from}`, To: `whatsapp:${c.phone}`, Body: text }),
  });
  if (!res.ok) throw new Error(`twilio ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

export async function notify(
  text: string,
  cfg: WhatsAppConfig,
  digestPath: string,
  log = console.log,
): Promise<void> {
  if (!text) { log('  nothing worth a message today'); return; }
  writeFileSync(digestPath, text, 'utf8');

  const transport = cfg.transport ?? (cfg.apikey ? 'callmebot' : cfg.authToken ? 'twilio' : 'none');
  try {
    if (transport === 'callmebot' && cfg.phone && cfg.apikey) {
      await sendCallMeBot(text, cfg);
      log(`  WhatsApp sent to ${cfg.phone}`);
      return;
    }
    if (transport === 'twilio' && cfg.phone && cfg.accountSid && cfg.authToken && cfg.from) {
      await sendTwilio(text, cfg);
      log(`  WhatsApp sent to ${cfg.phone} via Twilio`);
      return;
    }
    log(`  WhatsApp not configured - digest written to ${digestPath}`);
    log(`  one-click share: https://wa.me/?text=${encodeURIComponent(text).slice(0, 1800)}`);
  } catch (err: any) {
    // a failed message must never fail the run: the report is already written
    log(`  WhatsApp failed (${err.message})`);
    log(`  digest kept at ${digestPath}`);
  }
}
