# jobscout - context for Claude

Finds worldwide-remote engineering roles worth applying to, scores them, writes prep packs, and
notifies the owner each morning. **It never applies for anyone.** The letter skeleton in each
pack has a deliberate `[YOUR HOOK]` blank; do not fill it automatically. Personal, specific
applications are the whole point.

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
| `src/index.ts` | Orchestrator. Flags: `--no-fetch`, `--open` (local only) |
| `src/sources.ts` | RemoteOK, Remotive, Himalayas, WWR (RSS), Jobicy, Working Nomads, Real Work From Anywhere (scraped home page + sitemap dates), plus Ashby/Greenhouse/Lever boards. Per-source failures are isolated. Boards capped at newest 150. Non-http(s) URLs dropped at ingest |
| `src/score.ts` | Eligibility first (worldwide / friendly / unclear / restricted, factor 1 / 0.85 / 0.6 / 0.18), then fit. Location+title restrictions beat description wording. Gap in the title costs x2.5 |
| `src/direct.ts` | Finds the company's own board for promising jobs ("Apply direct"); cache keeps board identity only, never postings; no filesystem access |
| `src/tailor.ts` | Prep pack per job scoring >= thresholds.pack |
| `src/report.ts` | Self-contained HTML in the resume's palette. All text escaped; hrefs only http(s) via `safeUrl` |
| `src/notify.ts` | ntfy only. Digest sanitiser `safeField` - see Security |
| `src/store.ts` | Local mode: files in data/, out/. Cloud mode (`CI` set): `/api/store` with `Authorization: Bearer PUBLISH_KEY`. `assertCloudConfig` fails fast naming a missing secret |
| `api/report.js`, `api/store.js`, `api/kick.js` | The Vercel functions (plain JS, ESM) |
| `profile.json` | All tuning: titles, skill weights, gaps, eligibility phrases, projects, thresholds. The owner edits this |
| `watchlist.json` | Seed boards only. Discovered boards live in Redis (`jobscout:watchlist`) |
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
  or key. `detail()` in index.ts and `redact()` in notify.ts exist for this.
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
Leave NTFY_TOPIC unset in tests so nothing reaches the owner's phone.

Public run history (repo is public): `https://api.github.com/repos/vishal1785/jobscout/actions/runs`.
Full logs need a signed-in user; the jobs endpoint shows which step failed.

## Open items

- Owner to add `GH_DISPATCH_TOKEN` and `CRON_SECRET` on Vercel and redeploy; then confirm a
  `workflow_dispatch` run appears around 02:00-03:00 UTC.
- Idea, not built: read Greenhouse (`?questions=true`) and Ashby application forms and treat a
  "authorized to work in the US" question as a restriction signal. Counterpart's "Remote"
  Engineering Lead was the motivating case.
- Older commits contain discovered company names in watchlist.json history; a history rewrite was
  offered and not requested.
