# jobscout

Finds worldwide-remote engineering roles worth your evening, and prepares for them.

**It never applies for you.** It fetches, filters, scores and drafts. You read, you decide,
you write the personal part, you send. Applications that read as machine-made get binned, and
rightly so; the point here is to stop wasting nights on roles that were never open to you.

## Run it

```bash
node src/index.ts          # fetch, score, write the report and new prep packs
node src/index.ts --open   # the same, then open the report
node src/index.ts --no-fetch   # rebuild the report from stored jobs (fast, offline)
```

No dependencies and no build step: Node 24 runs the TypeScript directly, and `fetch` is
built in. The report lands in `out/report.html`, prep packs in `drafts/`.

## What it does

1. **Collects** from RemoteOK, Remotive, Himalayas, We Work Remotely, Jobicy, Working Nomads
   and Real Work From Anywhere, plus any company boards listed in `watchlist.json` (Ashby,
   Greenhouse and Lever are supported). All public endpoints, no logins, no bot-evasion. A
   dead source is logged and skipped. Boards over 150 postings are capped at the newest 150,
   so one staffing agency cannot drown the rest.
2. **De-duplicates** on company plus title, preferring the company's own board over an
   aggregator, because applying direct beats applying through a middleman.
3. **Judges eligibility**, the thing that matters most from India. Most "remote" jobs are
   remote-within-one-country. Each posting is read for wording and bucketed:
   - `worldwide` - says anywhere, global, or names India or Asia
   - `friendly` - a region you can work with: Europe, EMEA, UK, APAC
   - `unclear` - nothing stated; worth a check
   - `restricted` - US-only, hybrid, onsite, visa or clearance wording. Scored down hard
     but still listed, because occasionally a company flexes for the right person.
4. **Scores** the fit: engineering title, seniority, your stack, the differentiators that set
   you apart (LLM and agent work, Airflow, Databricks), minus the gaps. A gap in the title
   (say "Java Engineer") costs far more than the same word buried in a requirements list.
5. **Writes a prep pack** for anything above 60: why you fit, which projects to lead with,
   what to be honest about, ATS keywords the posting uses that your resume lacks, and a letter
   skeleton with a blank marked `[YOUR HOOK]`. It will not write the hook. That sentence is
   the whole difference between a personal application and a generated one.
6. **Reports** everything to a single HTML file, grouped into strong matches, worth a look,
   and good-role-wrong-geography.

Existing packs in `drafts/` are never overwritten, so your edits are safe.

## Tuning

Everything lives in `profile.json`:

- `titles.wanted` / `titles.reject` - what counts as your kind of role
- `skills.core` / `skills.differentiators` / `skills.gaps` - keywords and weights
- `eligibility.great` / `good` / `bad` - the phrases that decide the geography bucket
- `projects` - the lead paragraph and trigger words for each of your projects
- `resumeKeywords` - what your resume already says, used to spot missing ATS keywords
- `thresholds` - when a pack is written, and the strong / worth-a-look cutoffs

Add companies to watch in `watchlist.json`. The token is the slug in their board URL, for
example `https://jobs.ashbyhq.com/**ready**/...` or `https://boards.greenhouse.io/**b12**`.

## Honest limits

- **Eligibility is a guess** from the wording of a posting. Verify before applying.
- **Aggregators lag.** A role can be filled while still listed; check the company's own page.
- **Scoring is keyword-based.** It cannot tell a thoughtful team from a body shop. Treat the
  ranking as a reading order, not a verdict.
- **Sources change.** If one starts returning nothing, the run logs `FAILED` and carries on.

## The WhatsApp digest

The report only helps if you read it, so each run sends the top five new matches to your own
WhatsApp. Nothing is sent when nothing new crossed the threshold.

Setup, free and without a business account:

1. Save **+34 644 51 95 23** as a contact and send it exactly:
   `I allow callmebot to send me messages`
2. It replies with an API key.
3. `cp secrets.example.json secrets.json` and put your number and that key in it.
   `secrets.json` is gitignored and never leaves the machine.

Then `node src/index.ts` ends with `WhatsApp sent to +91...`. Twilio is supported too if you
ever want delivery receipts: set `transport: "twilio"` with `accountSid`, `authToken` and
`from` in the same file. With neither configured the digest is written to `out/digest.txt`
and a one-click `wa.me` link is printed. `--no-msg` skips it.

## Running it in the cloud

The laptop is off most of the time, so the daily run lives on GitHub Actions and
the report is served by Vercel. Nothing is scheduled locally any more, though
`npm run scout` still works exactly as before.

```
08:00 IST   GitHub Actions: scrape, score, write packs, send WhatsApp
            -> rendered report into Redis (Upstash / Vercel KV)
            -> any newly found company boards committed back to watchlist.json
anytime     https://<your-app>.vercel.app/r?k=<REPORT_KEY>  reads it back
```

Actions is the runner rather than a Vercel cron for three reasons: a full run
takes about 70 seconds against a 60-second function limit, Hobby crons fire
once a day only, and a serverless function has no writable disk to keep "new
since last" in. Actions has a six-hour budget and the state lives in Redis.

**This repo is public, so the generated data is deliberately not in it.** The
job list, the scores and the prep packs go to Redis, never to git. The report
URL also needs `?k=`, so a leaked URL alone shows nothing.

### Setup

| Where | Name | Value |
|---|---|---|
| Vercel - Storage | - | Add Upstash Redis; it sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` |
| Vercel - Env vars | `REPORT_KEY` | Any long random string |
| GitHub - Secrets | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Copy from Vercel |
| GitHub - Secrets | `JOBSCOUT_WA_PHONE`, `JOBSCOUT_WA_APIKEY` | Your number and the CallMeBot key |
| GitHub - Secrets | `JOBSCOUT_REPORT_URL` | `https://<your-app>.vercel.app/r?k=<REPORT_KEY>` |

Then run the workflow once by hand (Actions tab, "scout", Run workflow) instead
of waiting for the morning.

In CI the prep packs are folded into the report as an expandable block per job,
since there is no `drafts/` folder to write to - the preparation ends up on the
same screen as the role, which is better on a phone anyway.

### What the public can see

The repo is public, so its Actions logs are public too. The run therefore prints
counts only when `CI` is set - never a company, a score, a link or the digest.
The API key, the phone number and the keyed report URL are redacted from every
log line, including an error echoed back by CallMeBot. Run locally and you get
the full detail as before; `--quiet` forces the CI behaviour on the laptop.
