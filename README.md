# jobscout

Finds worldwide-remote engineering roles worth your evening, and prepares for them.

**It never applies for you.** It fetches, filters, scores and drafts. You read, you decide,
you write the personal part, you send. Applications that read as machine-made get binned, and
rightly so; the point here is to stop wasting nights on roles that were never open to you.

## How it runs

Every morning, with no laptop involved:

```
08:00 IST   GitHub Actions
              fetch ~1,000 postings, score them, write prep packs, render the report
              -> store it via jobscout-alpha.vercel.app/api/store
              -> push a notification to your ntfy topic
anytime     tap the notification -> /r?k=<REPORT_KEY> -> the report, packs inside
```

GitHub does the work, Vercel holds and shows the result, ntfy tells you. You get a
notification only when something new crossed the threshold, so silence means nothing worth
your time that day. GitHub sometimes starts scheduled runs 10-30 minutes late.

To run it now instead of waiting: Actions tab -> **scout** -> **Run workflow**.

## What it does

1. **Collects** from RemoteOK, Remotive, Himalayas, We Work Remotely, Jobicy, Working Nomads
   and Real Work From Anywhere, plus company boards on Ashby, Greenhouse and Lever. All public
   endpoints, no logins. A dead source is logged and skipped, and any board over 150 postings
   is capped at its newest 150 so one staffing agency cannot drown the rest.
2. **De-duplicates** on company plus title, preferring the company's own board over an
   aggregator's copy.
3. **Judges eligibility**, the thing that matters most from India. Most "remote" jobs are
   remote-within-one-country, so each posting is bucketed:
   - `worldwide` - says anywhere or global, or names India or Asia
   - `friendly` - a region you can work with: Europe, EMEA, UK, APAC
   - `unclear` - nothing stated; worth a check
   - `restricted` - US-only, hybrid, onsite, visa or clearance wording. Scored down hard
     but still listed, because occasionally a company flexes for the right person.
4. **Scores** the fit: engineering title, seniority, your stack, the differentiators that set
   you apart (LLM and agent work, Airflow, Databricks), minus the gaps. A gap in the title
   (say "Java Engineer") costs far more than the same word buried in a requirements list.
5. **Finds the direct link**: for promising roles it looks the company up on Ashby, Greenhouse
   and Lever, so you can apply on their own board. A company found this way is fetched
   natively from then on.
6. **Writes a prep pack** for anything scoring 60+: why you fit, which projects to lead with,
   what to be honest about, ATS keywords you lack, and a letter skeleton with a blank marked
   `[YOUR HOOK]`. It will not write the hook. That sentence is the whole difference between a
   personal application and a generated one.

## Tuning

Everything lives in `profile.json`; push a change and the next run uses it.

- `titles.wanted` / `titles.reject` - what counts as your kind of role
- `skills.core` / `skills.differentiators` / `skills.gaps` - keywords and weights
- `eligibility.great` / `good` / `bad` / `notMine` - phrases that decide the geography bucket
- `projects` - the lead paragraph and trigger words for each of your projects
- `resumeKeywords` - what your resume already says, used to spot missing ATS keywords
- `thresholds` - when a pack is written, and the strong / worth-a-look cutoffs

`watchlist.json` holds a few company boards to always fetch. The token is the slug in the
board URL, e.g. `jobs.ashbyhq.com/ready` or `boards.greenhouse.io/b12`.

## Setup

| Where | Name | What it is |
|---|---|---|
| Vercel - Storage | - | Upstash for Redis, connected to the project. It sets its own credentials, which nothing else ever needs |
| Vercel - Env vars | `REPORT_KEY` | A long random string. Opens the report |
| Vercel - Env vars | `PUBLISH_KEY` | A different long random string. Allows writing |
| GitHub - Actions secrets | `JOBSCOUT_SITE` | `https://jobscout-alpha.vercel.app` |
| GitHub - Actions secrets | `PUBLISH_KEY` | The same value as on Vercel - the handshake between the two |
| GitHub - Actions secrets | `NTFY_TOPIC` | Your ntfy topic |
| GitHub - Actions secrets | `JOBSCOUT_REPORT_URL` | `https://jobscout-alpha.vercel.app/r?k=<REPORT_KEY>` |

Redeploy on Vercel after changing its env vars; they only apply to new deployments. A run
with a GitHub secret missing fails straight away and names it.

**ntfy**: subscribe to your topic in the app. Anyone who knows an ntfy.sh topic can read it,
so make it random - it is effectively a password.

## Privacy

The repo is public, so nothing it generates goes into git. The job list, scores and prep
packs live in Redis, the report needs its key, and the page is `noindex`. Actions logs on a
public repo are public too, so a cloud run prints counts only - never a company, a score or a
link. Two keys rather than one because the report key travels in every notification and ends
up in browser history: whoever can read the report must not be able to replace it.

## Running it on a laptop

Optional - nothing needs to run locally. But it is handy for trying a `profile.json` change:

```bash
node src/index.ts              # fetch and score; report in out/, prep packs in drafts/
node src/index.ts --no-fetch   # rebuild from the last fetch, instantly
node src/index.ts --open       # either of the above, then open the report
```

No dependencies and no build step: Node 24 runs the TypeScript directly. Locally, existing
packs in `drafts/` are never overwritten, so edits are safe. Put `{ "ntfyTopic": "..." }` in
`secrets.json` (gitignored) to get a notification from a local run too.
