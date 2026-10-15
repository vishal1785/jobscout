/**
 * The daily report: one self-contained HTML file, no network, opens in a browser.
 * Styled to match the resume site so the whole job hunt looks like one thing.
 */
import type { Scored } from './score.ts';
import type { Unwatched } from './companies.ts';
import { slug } from './tailor.ts';
import { istDate, istDateTime } from './time.ts';

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// escaping the text is not enough for an href: a posting that arrived with a
// javascript: or data: URL would still run when clicked. Only http(s) is a link.
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? esc(u) : '');

const ELIG_LABEL: Record<string, string> = {
  worldwide: 'Worldwide',
  india: 'India',
  friendly: 'Region OK',
  unclear: 'Unclear',
  restricted: 'Restricted',
};

function card(j: Scored, isNew: boolean, packed: boolean, pack?: string, foundAt?: string): string {
  const age = Math.round((Date.now() - new Date(j.postedAt).getTime()) / 86_400_000);
  // posted is a date only: several sources send midnight UTC for "today", which
  // would read as a precise 05:30 IST. Found is when this tool first saw it.
  const posted = istDate(j.postedAt);
  const found = foundAt ? istDateTime(foundAt) : '';
  return `
  <article class="job ${j.eligibility}">
    <div class="top">
      <div>
        <h3>${esc(j.title)} ${isNew ? '<span class="new">new</span>' : ''}</h3>
        <p class="meta">${esc(j.company)} &middot; ${esc(j.location || 'Remote')} &middot; ${esc(j.source)}</p>
        <p class="times">${posted ? `Posted ${esc(posted)} (${age <= 0 ? 'today' : age + 'd ago'})` : 'Posting date unknown'}${found ? ` &middot; Found ${esc(found)}` : ''}</p>
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
      <a class="btn" href="${safeUrl(j.directUrl ?? j.url)}" target="_blank" rel="noopener">${j.directUrl ? 'Apply direct' : 'Open posting'}</a>
      ${j.directUrl ? `<a class="btn ghost" href="${safeUrl(j.url)}" target="_blank" rel="noopener">Listing</a>` : ''}
      ${packed && !pack ? `<a class="btn ghost" href="../drafts/${esc(slug(j))}.md">Prep pack</a>` : ''}
    </p>
    ${pack ? `<details class="pack"><summary>Prep pack</summary><pre>${esc(pack)}</pre></details>` : ''}
  </article>`;
}

const byNewest = (a: Scored, b: Scored) =>
  new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();

export function buildReport(
  jobs: Scored[], newIds: Set<string>, profile: any, stats: any,
  packs: Map<string, string> = new Map(),
  seen: Record<string, string> = {},
  unwatched: Unwatched[] = [],
): string {
  // jobs based in India get their own tab, with a lower bar: an office or hybrid
  // role in India is open to him in a way most "remote" roles are not
  const global = jobs.filter((j) => j.eligibility !== 'india');
  const strong = global.filter((j) => j.score >= profile.thresholds.strong).sort(byNewest);
  const worth = global.filter((j) => j.score >= profile.thresholds.worthALook && j.score < profile.thresholds.strong).sort(byNewest);
  const india = jobs
    .filter((j) => j.eligibility === 'india' && j.score >= (profile.thresholds.india ?? profile.thresholds.worthALook))
    .sort(byNewest);
  const restricted = jobs
    .filter((j) => j.eligibility === 'restricted' && j.score > 12)
    .sort(byNewest)
    .slice(0, 15);

  // each section folds away (plain <details>, no script); the long tail of
  // wrong-geography roles starts folded so the morning read stays short
  const tabs: Array<{ id: string; title: string; count: number }> = [];
  const fold = (id: string, title: string, count: number, open: boolean, body: string) => {
    tabs.push({ id, title, count });
    return `
    <details class="sec" id="${id}"${open ? ' open' : ''}>
      <summary><h2>${title} <span class="count">${count}</span></h2></summary>
      ${body}
    </details>`;
  };
  const section = (id: string, title: string, note: string, list: Scored[], open = true) => fold(id, title, list.length, open, `
      <p class="note">${note}</p>
      ${list.length ? list.map((j) => card(j, newIds.has(j.id), j.score >= profile.thresholds.pack, packs.get(j.id), seen[j.id])).join('') : '<p class="empty">Nothing today.</p>'}`);

  // built in page order, so the tab bar can list them afterwards
  const body = [
    section('strong', 'Strong matches', 'Worth an application today. Check the role is still open before writing anything.', strong),
    section('worth', 'Worth a look', 'Decent overlap, or a gap you can answer honestly. Newest first, like every list here.', worth),
    section('india', 'Based in India', 'Roles located in India, remote, hybrid or in an office: no visa or time-zone question. The bar is lower than for worldwide roles; the location says whether it means moving.', india),
    section('geo', 'Good role, wrong geography', 'Scored down because the posting reads as country-restricted. Occasionally worth an email asking whether they hire from India.', restricted, false),
  ];
  if (unwatched.length) body.push(fold('hand', 'Check by hand', unwatched.length, false, `
      <p class="note">Companies in companies.json whose jobs cannot be fetched. Worth a look at their own careers page now and then.</p>
      <ul class="hand">${unwatched.map((u) => `<li>${safeUrl(u.careers) ? `<a href="${safeUrl(u.careers)}" target="_blank" rel="noopener">${esc(u.name)}</a>` : esc(u.name)} <span>${esc(u.why)}</span></li>`).join('')}</ul>`));

  const nav = tabs.map((t) => `<a href="#${t.id}">${t.title} <b>${t.count}</b></a>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job scout - ${istDate(Date.now())}</title>
<style>
  :root{ --rail:#0F3B33; --mint:#5FCBA8; --ink:#16211E; --soft:#5C6B67; --line:#DCE5E2;
         --wash:#F3F7F5; --paper:#fff; --warn:#B45309; --mono:ui-monospace,'Cascadia Mono',Consolas,monospace;
         --sans:'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif; color-scheme:light; }
  *{box-sizing:border-box} body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.55}
  header{background:var(--rail);color:#E4F0EC;padding:26px clamp(18px,4vw,48px)}
  header h1{margin:0;font-size:1.5rem;letter-spacing:-.02em}
  header p{margin:6px 0 0;font-family:var(--mono);font-size:12px;color:#A9C7BE}
  main{max-width:1000px;margin:0 auto;padding:0 clamp(18px,4vw,48px) 64px}
  .tabs{position:sticky;top:0;z-index:5;background:var(--paper);border-bottom:1px solid var(--line);
        display:flex;gap:4px;overflow-x:auto;padding:8px clamp(18px,4vw,48px);scrollbar-width:none}
  .tabs a{flex:none;font-family:var(--mono);font-size:12px;text-decoration:none;color:var(--rail);
          padding:6px 10px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
  .tabs a b{font-weight:600;color:var(--soft);margin-left:4px}
  .tabs a:hover{background:var(--wash)}
  .sec{margin-top:40px;scroll-margin-top:56px}
  .job.india{border-left-color:#E0A458}
  .elig.india{color:#A45F12}
  .sec>summary{list-style:none;cursor:pointer}
  .sec>summary::-webkit-details-marker{display:none}
  h2{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--rail);margin:0;
     border-bottom:1px solid var(--line);padding-bottom:8px;display:flex;justify-content:space-between}
  h2::before{content:'\\25B8';display:inline-block;width:1.4em;transition:transform .15s}
  .sec[open] h2::before{transform:rotate(90deg)}
  h2 .count{margin-left:auto}
  .times{margin:2px 0 0;font-family:var(--mono);font-size:11.5px;color:var(--soft)}
  .hand{list-style:none;padding:0;margin:12px 0 0}
  .hand li{padding:8px 0;border-bottom:1px solid var(--line);font-size:14px}
  .hand a{color:var(--rail);font-weight:600}
  .hand span{color:var(--soft);font-size:12.5px;margin-left:6px}
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
  .pack{margin:12px 0 0;border-top:1px solid var(--line);padding-top:10px}
  .pack summary{font-family:var(--mono);font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--rail);cursor:pointer}
  .pack pre{white-space:pre-wrap;font-family:var(--mono);font-size:12px;line-height:1.5;background:#fff;
            border:1px solid var(--line);padding:12px;margin:10px 0 0;overflow-x:auto;color:var(--ink)}
  footer{max-width:1000px;margin:0 auto;padding:24px clamp(18px,4vw,48px) 60px;color:var(--soft);font-size:12.5px;border-top:1px solid var(--line)}
</style></head>
<body>
<header>
  <h1>Job scout</h1>
  <p>${istDateTime(Date.now())} &middot; ${stats.fetched} fetched &middot; ${stats.newCount} new &middot; ${stats.packs} prep packs written</p>
</header>
<nav class="tabs">${nav}</nav>
<main>
  ${body.join('')}
</main>
<script>
  // a tab jumps to its section; a folded section is opened on the way, so the
  // jump never lands on a closed heading. Without script the links still jump.
  function openTarget() {
    var el = location.hash && document.getElementById(location.hash.slice(1));
    if (el && el.tagName === 'DETAILS') el.open = true;
  }
  window.addEventListener('hashchange', openTarget);
  openTarget();
</script>
<footer>
  Sources: RemoteOK, Remotive, Himalayas, We Work Remotely, Jobicy, Working Nomads, Real Work From Anywhere,
  and company boards on Ashby, Greenhouse, Lever and SmartRecruiters. Times are IST.
  Eligibility is guessed from the wording of each posting and is sometimes wrong - always verify before applying.
  Nothing here is submitted automatically: every application stays yours to write and send.
</footer>
</body></html>`;
}
