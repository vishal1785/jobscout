# jobscout - context for Claude

Finds worldwide-remote engineering roles worth applying to, scores them, writes prep packs, and
notifies the owner each morning. **It never applies for anyone**: nothing is ever submitted.
Until 2026-10-18 the letter had a deliberate `[YOUR HOOK]` blank; the owner then asked for the
job-related answers ("why us", proud of, tough call, best work) to be drafted, and chose
templates over an AI API. `src/answers.ts` stitches them from `profile.stories` (facts from
the resume and interview prep only) and the posting itself. **Never invent a fact or a number
in a story**; if a story needs one he hasn't given, leave it out.

Private context (owner, applications, where secrets live) is in `CLAUDE.local.md`, which is
gitignored. Read it too.

## Architecture

```
Vercel cron 02:00 UTC (fires 07:30-08:30 IST)
  -> api/kick.js            asks GitHub to run the workflow (workflow_dispatch)
GitHub Actions  .github/workflows/daily.yml   (backup schedule 04:13 UTC)
  -> node src/index.ts      fetch ~1,000 postings, score, packs, render report
  -> POST /api/store        state + report into Upstash Redis via the deployment
  -> ntfy.sh/<topic>        push notification; tapping opens the report
Vercel
  /r?k=<REPORT_KEY>         api/report.js reads the report from Redis and serves it
  /api/store                api/store.js: the only holder of the Redis credentials
```

GitHub's own scheduler is best-effort (a run once started 7 hours late), which is why Vercel's
cron triggers the run. Vercel functions cap at 60s and have no persistent disk, which is why the
work runs on Actions rather than in a Vercel function.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Orchestrator. Flags: `--no-fetch`, `--open` (local only). Throws if every source fails, so a network outage cannot replace yesterday's report with an empty one |
| `src/sources.ts` | RemoteOK (plain API gives the newest ~100; 11 `?tag=` queries give ~490 unique - but ~80% are tied to a US/EU city and the median is ~88 days old, so few survive eligibility; that is the site, not a bug), Remotive (free API capped at 15 since 2026; paid API only - nothing more to get), Himalayas (search API with `country=India`, 8 engineering queries x 4 pages, ~370 jobs open to India; the plain feed's newest 200 covered one day of 120k), WWR (5 RSS feeds), Jobicy (dev industry, ~100, all taken), Working Nomads (~50, all taken), Real Work From Anywhere (scraped home page, ~280, + sitemap dates; its `<li>` gained classes on 2026-10-17 and the scraper silently returned 0), Hacker News "Who is hiring?" (Algolia API, keyless; `parseHnPost` reads "Company | Role | Location" or "Company:/Location:" heads, skips the rest; ~160 of ~260 posts parse, only a few a month pass eligibility - mostly US roles; last month's thread is read too in a thread's first 10 days), plus Ashby/Greenhouse/Lever (incl. EU instance, `lever-eu`)/SmartRecruiters boards. SmartRecruiters lists carry no description, so only the newest 40 engineering titles get a detail fetch. `isBoard()` is the one test for "came from a company board". Per-source failures are isolated. Boards capped at newest 150. Non-http(s) URLs dropped at ingest |
| `src/score.ts` | Eligibility first (worldwide / india / friendly / unclear / restricted, factor 1 / 1 / 0.85 / 0.6 / 0.18), then fit. `india` = every place in the location is in India (`whereInIndia`, `eligibility.indiaPlaces`), checked before blocked words so "Hyderabad (Hybrid)" passes; India among other countries = worldwide. India jobs get their own report tab with `thresholds.india` (55; was 35 until Himalayas' India search brought ~90 India jobs a day) and are left out of Strong/Worth. Any other place named in the location (`namedPlaces`: London, France, EMEA, "CET +/- 3h") = restricted, since 2026-10-16 when the owner saw Germany/London/Brazil roles in Strong; APAC/Asia among the places = worldwide; `friendly` now only comes from a bare "Asia" (APAC stays worldwide), or from the description when the location is just "Remote". Owner's rules of 2026-10-16: a required language (`languageRequired`, `eligibility.languages`; "is a plus" sentences ignored) and "anywhere in <not the world>" (`anywhereIn`) are restricted, checked before any worldwide phrase. Stated USD pay (`statedPayUSD`, field or text) >= `pay.targetUSD` adds 8. No >45-day penalty for live-only sources (boards, WWR) - Sticker Mule's evergreen WWR post was missed for that. Location+title restrictions beat description wording. Gap in the title costs x2.5. All keyword matching goes through `hasWord` (whole word, optional plural): until 2026-10-18 it was substring matching, so "java" hit every JavaScript job, "scala" scalable, "rails" guardrails, "rag" storage, "intern" internal, "usa" usability. `excludeCompanies` in profile.json scores a company 0 (Lemon.io, 2026-10-17: never hires in India despite worldwide-looking locations) |
| `src/direct.ts` | Finds the company's own board for promising jobs ("Apply direct"); cache keeps board identity only, never postings; no filesystem access |
| `src/forms.ts` | `applyLink` deep-links to the form itself (Ashby /application, Lever /apply, Greenhouse #app, SmartRecruiters ?oga=true). Reads the application form (Greenhouse `?questions=true`, Ashby's public job-page GraphQL, Lever's apply page) of jobs >= worthALook, cap 60, no cache. A US work-authorization question sets `job.formBlock`, which scores 0 (skipped, not demoted). Ignored when scoped to US applicants or paired with a non-US question (DuckDuckGo's form) |
| `src/tailor.ts` | Prep pack per job scoring >= thresholds.pack: drafted answers (the form's own open questions, kept by forms.ts as `job.formQuestions`, else the usual four) and a full letter |
| `src/answers.ts` | Template drafting: `classify` a form label (why/proud/best/tough/ambiguity/ai/remote/stack/other, null = personal field he fills), `draft` from `profile.stories`, `missionLine` turns the posting's "We are building X" into "you are building X", `gapLine` only for gaps in the title or first 600 chars |
| `src/picks.ts` | Today's shortlist: first seen within 20h (so the late backup run keeps the same picks), best score first, max 2 per company; 15 worldwide + 5 India (`profile.picks`). The digest sends only this run's new picks |
| `src/report.ts` | Self-contained HTML in the resume's palette. A warning band names any job site that returned 0 or failed (`SourceHealth` from fetchAll; boards only when they fail, since an empty board is normal). All text escaped; hrefs only http(s) via `safeUrl` |
| `src/notify.ts` | ntfy only. Digest sanitiser `safeField` - see Security |
| `src/store.ts` | Local mode: files in data/, out/. Cloud mode (`CI` set): `/api/store` with `Authorization: Bearer PUBLISH_KEY`. `assertCloudConfig` fails fast naming a missing secret |
| `api/report.js`, `api/store.js`, `api/kick.js` | The Vercel functions (plain JS, ESM) |
| `profile.json` | All tuning: titles, skill weights, gaps, eligibility phrases, projects, thresholds. The owner edits this |
| `companies.json` | The owner's list of companies to watch (public; the owner chose that). On 2026-10-27 it gained 108 boards from the Work Wanderers "221 fully-remote companies" PDF (the owner chose public despite its no-redistribution notice): each careers page was scanned for its ATS link, else the name probed, and name-probed boards were checked for identity - "Remote" (General Assembly), "Crisp" (a Dutch grocer) and "Ghost" (AI hardware) were wrong and dropped; "Plane" is plane.so. ~92 had no readable board and 8 use Workable/Breezy, which jobscout cannot read yet. Name only -> board looked up each run; `board: "ats:token"` pins it; `careers` -> "Check by hand" in the report. Replaced watchlist.json. Discovered boards still live in Redis (`jobscout:watchlist`) |
| `src/companies.ts` | Resolves companies.json to boards. `node src/companies.ts` prints each entry's board, job count and two sample titles, to catch a slug that belongs to another company ("wise" on Greenhouse is not Wise) |
| `src/time.ts` | IST formatting (`Asia/Kolkata`, set explicitly since Actions runs in UTC). Report: posted = date only, found (first seen, from `state.seen`) = date and time |
| `test/fake-vercel.mjs` | Local stand-in for Vercel + Upstash; see Testing |

Store keys: `jobscout:state` (seen ids), `jobscout:report`, `jobscout:watchlist`,
`jobscout:board-cache`. `/api/store` only accepts keys matching `^jobscout:[a-z-]{1,40}$`.

## Secrets (names only - never commit values)

- Vercel env: Upstash `KV_REST_API_URL`/`KV_REST_API_TOKEN` (auto, marked sensitive),
  `REPORT_KEY` (read the report), `PUBLISH_KEY` (write), `CRON_SECRET`, `GH_DISPATCH_TOKEN`
  (fine-grained PAT: this repo, Actions read/write)
- GitHub Actions secrets: `JOBSCOUT_SITE`, `PUBLISH_KEY` (same value as Vercel), `NTFY_TOPIC`,
  `JOBSCOUT_REPORT_URL`
- Two keys on purpose: REPORT_KEY travels in notification URLs and browser history; whoever can
  read the report must not be able to overwrite it.

## Privacy rules (the repo is public)

- No generated data in git: data/, out/, drafts/, secrets.json are gitignored. Never commit them,
  even to "fix" CI.
- Actions logs are public: in cloud mode print counts only, never a company, score, link, topic
  or key. `detail()` in index.ts and `redact()` in notify.ts exist for this, and fetchAll sums
  company boards into one line in the cloud (until 2026-10-27 it printed each board's name,
  discovered ones included). A full run with ~120 boards takes ~5 minutes of the 15 allowed.
- Discovered company boards are a record of where the owner applies: keep them out of git.
- The workflow has `permissions: contents: read` and must not write back to the repo.

## Security notes

The digest is line-structured and job titles are third-party (some scraped). `safeField` in
notify.ts: flatten to one line, NFKC-normalise, map dot lookalikes (U+3002, U+FF61, U+2024,
U+2027) to '.', strip invisible chars and emphasis marks BEFORE link detection (stripping after
lets `ht*tps://` reassemble), then replace any scheme, www., domain-with-path (Unicode-aware,
skipping js/ts/net/... so `Node.js/React` and `ASP.NET` survive) and bare IPv4 with `[link]`.
Bare domains without a path are deliberately kept (company names like Salesforce.com).
Seven review rounds went into this; only change it with a concrete failing payload in hand.

## Conventions

- Zero dependencies, no build: Node 24 runs the .ts directly. Keep it that way.
- Source must be plain ASCII. Write Unicode as `\uXXXX` escapes; after editing regexes, scan for
  non-ASCII bytes. Shell heredocs on this machine collapse backslashes and once wrote literal
  control and line-separator characters into the source - use the Edit/Write tools for any
  code containing backslashes.
- Comments explain why, in plain sentences. Commit messages: a short subject, then prose on what
  was wrong and why the fix is right.
- The owner's laptop runs nothing on a schedule (the Windows task was removed on purpose).

## Testing - do this before pushing anything that touches the cloud path

The original CI failure (writing to gitignored data/) passed every local test because the laptop
had the folder. So test from a fresh clone, in cloud mode:

```bash
git clone -q . /tmp/ci-clone && cd /tmp/ci-clone      # committed files only, like a runner
node test/fake-vercel.mjs &                           # Vercel :7788 + Upstash :7777
CI=true JOBSCOUT_SITE=http://127.0.0.1:7788 PUBLISH_KEY=write-key node src/index.ts
curl "http://127.0.0.1:7788/r?k=read-key"             # the report a phone would open
```

Expect exit 0, no data/, out/ or drafts/ created, and "New since last: 0" on a second run.
Leave NTFY_TOPIC unset in tests so nothing reaches the owner's phone. Never run it from the
real repo folder, and stop fake-vercel.mjs when done: on 2026-10-16 a leftover server kept
the scratch folder busy, `rm && cd` failed, the run happened in the repo and read the
topic from secrets.json. Cloud mode now ignores secrets.json for the topic.

Public run history (repo is public): `https://api.github.com/repos/vishal1785/jobscout/actions/runs`.
Full logs need a signed-in user; the jobs endpoint shows which step failed.

## Open items

- The Vercel cron works: its first dispatch ran 2026-10-15 02:05 UTC (07:35 IST) and
  succeeded. GitHub's backup schedule fired 5h late again that day.
- Sources weighed on 2026-10-26 and not added: The Muse (0 of 120 remote jobs pass), Arbeitnow
  (German cities), Adzuna/Careerjet/Findwork (need signup keys; Adzuna India is mostly office
  jobs), Apify LinkedIn scrapers (~$0.30-5 per 1,000 jobs within Apify's $5/month free credit;
  the largest relevant pool, but against LinkedIn's terms - the owner declined for now).
- Known gap in the form check: wording that names several regions ("based in the U.S.,
  Canada, LATAM, or authorized to work in one of these", seen at Ramp) is not caught.
- Older commits contain discovered company names in watchlist.json history; a history rewrite was
  offered and not requested.
