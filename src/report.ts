/**
 * The daily report: one self-contained HTML file, no network, opens in a browser.
 * Styled to match the resume site so the whole job hunt looks like one thing.
 */
import type { Scored } from './score.ts';
import { slug } from './tailor.ts';

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ELIG_LABEL: Record<string, string> = {
  worldwide: 'Worldwide',
  friendly: 'Region OK',
  unclear: 'Unclear',
  restricted: 'Restricted',
};

function card(j: Scored, isNew: boolean, packed: boolean): string {
  const age = Math.round((Date.now() - new Date(j.postedAt).getTime()) / 86_400_000);
  return `
  <article class="job ${j.eligibility}">
    <div class="top">
      <div>
        <h3>${esc(j.title)} ${isNew ? '<span class="new">new</span>' : ''}</h3>
        <p class="meta">${esc(j.company)} &middot; ${esc(j.location || 'Remote')} &middot; ${age <= 0 ? 'today' : age + 'd ago'} &middot; ${esc(j.source)}</p>
      </div>
      <div class="right">
        <span class="score">${j.score}</span>
        <span class="elig ${j.eligibility}">${ELIG_LABEL[j.eligibility]}</span>
      </div>
    </div>
    ${j.salary ? `<p class="salary">${esc(j.salary)}</p>` : ''}
    ${j.matched.length ? `<p class="kw">${j.matched.slice(0, 12).map((m) => `<span>${esc(m)}</span>`).join('')}</p>` : ''}
    ${j.gaps.length ? `<p class="gaps">gaps: ${j.gaps.slice(0, 6).map(esc).join(', ')}</p>` : ''}
    <p class="why">${esc(j.eligibilityWhy)}</p>
    <p class="actions">
      <a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener">Open posting</a>
      ${packed ? `<a class="btn ghost" href="../drafts/${esc(slug(j))}.md">Prep pack</a>` : ''}
    </p>
  </article>`;
}

export function buildReport(jobs: Scored[], newIds: Set<string>, profile: any, stats: any): string {
  const strong = jobs.filter((j) => j.score >= profile.thresholds.strong);
  const worth = jobs.filter((j) => j.score >= profile.thresholds.worthALook && j.score < profile.thresholds.strong);
  const restricted = jobs
    .filter((j) => j.eligibility === 'restricted' && j.score > 12)
    .slice(0, 15);

  const section = (title: string, note: string, list: Scored[]) => `
    <section>
      <h2>${title} <span class="count">${list.length}</span></h2>
      <p class="note">${note}</p>
      ${list.length ? list.map((j) => card(j, newIds.has(j.id), j.score >= profile.thresholds.pack)).join('') : '<p class="empty">Nothing today.</p>'}
    </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job scout - ${new Date().toISOString().slice(0, 10)}</title>
<style>
  :root{ --rail:#0F3B33; --mint:#5FCBA8; --ink:#16211E; --soft:#5C6B67; --line:#DCE5E2;
         --wash:#F3F7F5; --paper:#fff; --warn:#B45309; --mono:ui-monospace,'Cascadia Mono',Consolas,monospace;
         --sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif; color-scheme:light; }
  *{box-sizing:border-box} body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.55}
  header{background:var(--rail);color:#E4F0EC;padding:26px clamp(18px,4vw,48px)}
  header h1{margin:0;font-size:1.5rem;letter-spacing:-.02em}
  header p{margin:6px 0 0;font-family:var(--mono);font-size:12px;color:#A9C7BE}
  main{max-width:1000px;margin:0 auto;padding:0 clamp(18px,4vw,48px) 64px}
  section{margin-top:40px}
  h2{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--rail);
     border-bottom:1px solid var(--line);padding-bottom:8px;display:flex;justify-content:space-between}
  .count{color:var(--soft)}
  .note{color:var(--soft);font-size:13.5px;margin:10px 0 0}
  .empty{color:var(--soft);font-size:14px;padding:14px 0}
  .job{background:var(--wash);border-left:4px solid var(--mint);padding:16px 18px;margin-top:12px}
  .job.restricted{border-left-color:#D9A441;opacity:.75}
  .job.unclear{border-left-color:#9CC9BC}
  .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
  h3{margin:0;font-size:1.08rem;letter-spacing:-.015em}
  .new{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
       background:var(--mint);color:var(--rail);padding:2px 7px;border-radius:999px;vertical-align:2px}
  .meta{margin:3px 0 0;font-size:13px;color:var(--soft)}
  .right{text-align:right;white-space:nowrap}
  .score{display:inline-block;font-family:var(--mono);font-weight:600;font-size:15px;color:var(--rail)}
  .elig{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-top:4px;color:var(--soft)}
  .elig.worldwide{color:#1F7A60} .elig.restricted{color:var(--warn)}
  .salary{margin:8px 0 0;font-family:var(--mono);font-size:12px;color:#1F7A60}
  .kw{margin:10px 0 0;display:flex;flex-wrap:wrap;gap:5px}
  .kw span{font-family:var(--mono);font-size:10.5px;padding:2px 8px;border:1px solid #C9D8D3;color:var(--soft);background:#fff}
  .gaps{margin:8px 0 0;font-family:var(--mono);font-size:11.5px;color:var(--warn)}
  .why{margin:8px 0 0;font-size:12.5px;color:var(--soft)}
  .actions{margin:12px 0 0;display:flex;gap:8px}
  .btn{font-family:var(--mono);font-size:12px;text-decoration:none;padding:7px 12px;background:var(--rail);color:#E4F0EC}
  .btn.ghost{background:transparent;color:var(--rail);border:1px solid var(--line)}
  .btn:hover{background:#134A40;color:#fff}
  footer{max-width:1000px;margin:0 auto;padding:24px clamp(18px,4vw,48px) 60px;color:var(--soft);font-size:12.5px;border-top:1px solid var(--line)}
</style></head>
<body>
<header>
  <h1>Job scout</h1>
  <p>${new Date().toLocaleString()} &middot; ${stats.fetched} fetched &middot; ${stats.newCount} new &middot; ${stats.packs} prep packs written</p>
</header>
<main>
  ${section('Strong matches', 'Worth an application today. Check the role is still open before writing anything.', strong)}
  ${section('Worth a look', 'Decent overlap, or a gap you can answer honestly. Skim before committing an evening.', worth)}
  ${section('Good role, wrong geography', 'Scored down because the posting reads as country-restricted. Occasionally worth an email asking whether they hire from India.', restricted)}
</main>
<footer>
  Sources: RemoteOK, Remotive, Himalayas, We Work Remotely, plus the company boards in watchlist.json.
  Eligibility is guessed from the wording of each posting and is sometimes wrong - always verify before applying.
  Nothing here is submitted automatically: every application stays yours to write and send.
</footer>
</body></html>`;
}
