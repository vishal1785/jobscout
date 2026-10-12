/**
 * WhatsApp delivery.
 *
 * The report only helps if you actually look at it, so the run ends by sending
 * a short digest to your own WhatsApp. Two transports, both optional:
 *
 *   callmebot  free, no business account. Message "I allow callmebot to send me
 *              messages" to +34 644 94 58 67 on WhatsApp, and it replies with an
 *              API key. Only sends to your own number, which is all this needs.
 *   twilio     for when you want delivery receipts or a second recipient.
 *
 * With neither configured nothing is sent and the digest is written to
 * out/whatsapp.txt, with a wa.me link printed so one click still shares it.
 */
import { writeFileSync } from 'node:fs';
import type { Scored } from './score.ts';

export type WhatsAppConfig = {
  transport?: 'telegram' | 'ntfy' | 'webhook' | 'callmebot' | 'twilio' | 'none';
  phone?: string;          // your number in international form, e.g. +919552565520
  apikey?: string;         // callmebot
  accountSid?: string;     // twilio
  authToken?: string;      // twilio
  from?: string;           // twilio sandbox number, e.g. +14155238886
  botToken?: string;       // telegram
  chatId?: string;         // telegram
  topic?: string;          // ntfy
  server?: string;         // ntfy, if self-hosted
  webhook?: string;        // any Slack or Discord incoming webhook URL
  maxJobs?: number;
};

const short = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, '');

/** Strips the WhatsApp emphasis marks for transports that do not render them. */
export const plain = (text: string) => text.replace(/\*(.+?)\*/g, '$1');

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
  // a tappable link to the hosted report, when there is one. WhatsApp only
  // linkifies a bare URL, so it goes on its own line with nothing around it.
  const site = process.env.JOBSCOUT_REPORT_URL;
  if (site) {
    lines.push('Full list and prep packs:');
    lines.push(site);
  } else {
    lines.push('Prep packs are in drafts/, full list in out/report.html');
  }
  return lines.join('\n');
}

/**
 * Anything that might reach a log goes through this first. The CI logs of a
 * public repo are world-readable, so the API key, the phone number and the
 * keyed report URL must never appear in them - not even inside an error
 * message echoed back by the upstream service.
 */
function redact(s: string, c: WhatsAppConfig): string {
  let out = s;
  for (const v of [c.apikey, c.authToken, c.accountSid, c.botToken, c.topic, c.webhook,
                   process.env.JOBSCOUT_REPORT_URL]) {
    if (v) out = out.split(v).join('[redacted]');
  }
  if (c.phone) out = out.split(c.phone).join(maskPhone(c.phone));
  return out;
}

const maskPhone = (p: string) => p.slice(0, 3) + '*'.repeat(Math.max(0, p.length - 5)) + p.slice(-2);

async function sendCallMeBot(text: string, c: WhatsAppConfig): Promise<void> {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(c.phone!)}`
    + `&apikey=${encodeURIComponent(c.apikey!)}&text=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  const body = await res.text();
  // they answer 200 with an HTML page even on failure, so the body is the real signal
  if (!res.ok || /error|invalid|not allowed/i.test(body)) {
    const why = redact(body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), c);
    throw new Error(`callmebot refused: ${why.slice(0, 160)}`);
  }
}

/**
 * Telegram. The most reliable of the lot and free with no business account:
 * @BotFather gives you a bot token in under a minute. `--chat-id` finds the
 * chat id once you have sent the bot a message.
 */
async function sendTelegram(text: string, c: WhatsAppConfig): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: c.chatId,
      text: plain(text),
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body as any).ok === false) {
    throw new Error(redact(`telegram: ${(body as any).description ?? res.status}`, c));
  }
}

/** ntfy.sh: no account at all, just an app and a topic nobody else guesses. */
async function sendNtfy(text: string, c: WhatsAppConfig): Promise<void> {
  const base = c.server ?? 'https://ntfy.sh';
  const site = process.env.JOBSCOUT_REPORT_URL;
  const res = await fetch(`${base}/${c.topic}`, {
    method: 'POST',
    headers: {
      title: 'Job scout',
      tags: 'briefcase',
      ...(site ? { click: site } : {}),
    },
    body: plain(text),
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}: ${(await res.text()).slice(0, 120)}`);
}

/** Slack or Discord incoming webhook - both accept a JSON body with text. */
async function sendWebhook(text: string, c: WhatsAppConfig): Promise<void> {
  const discord = /discord(app)?\.com/.test(c.webhook ?? '');
  const res = await fetch(c.webhook!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(discord ? { content: plain(text) } : { text: plain(text) }),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text()).slice(0, 120)}`);
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
  // in CI there is no one at the terminal and the log is public, so the digest
  // itself - which carries the keyed report URL - stays out of it
  const inCI = Boolean(process.env.CI);
  if (!inCI) writeFileSync(digestPath, text, 'utf8');

  const transport = cfg.transport ?? (
    cfg.botToken && cfg.chatId ? 'telegram'
    : cfg.topic ? 'ntfy'
    : cfg.webhook ? 'webhook'
    : cfg.apikey ? 'callmebot'
    : cfg.authToken ? 'twilio'
    : 'none');
  try {
    if (transport === 'telegram' && cfg.botToken && cfg.chatId) {
      await sendTelegram(text, cfg);
      log('  sent on Telegram');
      return;
    }
    if (transport === 'ntfy' && cfg.topic) {
      await sendNtfy(text, cfg);
      log('  pushed via ntfy');
      return;
    }
    if (transport === 'webhook' && cfg.webhook) {
      await sendWebhook(text, cfg);
      log('  posted to the webhook');
      return;
    }
    if (transport === 'callmebot' && cfg.phone && cfg.apikey) {
      await sendCallMeBot(text, cfg);
      log(`  WhatsApp sent to ${maskPhone(cfg.phone)}`);
      return;
    }
    if (transport === 'twilio' && cfg.phone && cfg.accountSid && cfg.authToken && cfg.from) {
      await sendTwilio(text, cfg);
      log(`  WhatsApp sent to ${maskPhone(cfg.phone)} via Twilio`);
      return;
    }
    if (inCI) {
      log('  no messaging transport configured - see the README');
      return;
    }
    log(`  no messaging transport configured - digest written to ${digestPath}`);
    log(`  one-click share: https://wa.me/?text=${encodeURIComponent(text).slice(0, 1800)}`);
  } catch (err: any) {
    // a failed message must never fail the run: the report is already written
    log(`  message failed (${redact(err.message, cfg)})`);
    if (!inCI) log(`  digest kept at ${digestPath}`);
  }
}
