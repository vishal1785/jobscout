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
your time that day.

The run is started by **Vercel's cron**, not GitHub's. GitHub's scheduler is best-effort and
has started this run seven hours late; Vercel's fires within the hour (07:30-08:30 IST) and
calls `api/kick.js`, which asks GitHub to run the workflow - the same as pressing the button.
GitHub's own schedule stays on at 09:43 IST as a backup; if the main run already happened,
the backup finds nothing new and sends nothing.

To run it now instead of waiting: Actions tab -> **scout** -> **Run workflow**.

## What it does

1. **Collects** from RemoteOK, Remotive, Himalayas, We Work Remotely, Jobicy, Working Nomads
   and Real Work From Anywhere, plus the company boards listed in `companies.json` (Ashby,
   Greenhouse, Lever and SmartRecruiters). All public
   endpoints, no logins. A dead source is skipped, and the report says so at the top: a job
   site returning nothing usually means it changed its page and its reader needs fixing. Any
   board over 150 postings is capped at its newest 150 so one staffing agency cannot drown the
   rest. Himalayas is searched for engineering roles open to India rather than read as a
   feed, since its feed's newest 200 cover about a day; Remotive's free API gives only its
   newest 15.
2. **De-duplicates** on company plus title, preferring the company's own board over an
   aggregator's copy.
3. **Judges eligibility**, the thing that matters most from India. Most "remote" jobs are
   remote-within-one-country, so each posting is bucketed:
   - `worldwide` - says anywhere or global, or names India or Asia
   - `india` - located in India (its own tab in the report)
   - `friendly` - a bare "Asia", or a location of just "Remote" with a region in the description
   - a required language other than English or Hindi ("fluent German", "native Japanese",
     "Mandarin is a must"; not "German is a plus") makes any job `restricted`, and so does
     "anywhere in China" or any other "anywhere in <somewhere>" short of the world
   - a location that names any other place (London, Munich, France, "CET +/- 3h", EMEA) is
     `restricted`: such a role hires there, whatever its description says. APAC or Asia among
     the places counts as worldwide, since it takes in India
   - `unclear` - nothing stated; worth a check
   - `restricted` - US-only, hybrid, onsite, visa or clearance wording. Scored down hard
     but still listed, because occasionally a company flexes for the right person.
4. **Scores** the fit: engineering title, seniority, your stack, the differentiators that set
   you apart (LLM and agent work, Airflow, Databricks), minus the gaps. A gap in the title
   (say "Java Engineer") costs far more than the same word buried in a requirements list.
5. **Finds the direct link**: for promising roles it looks the company up on Ashby, Greenhouse
   and Lever, so you can apply on their own board. A company found this way is fetched
   natively from then on.
6. **Reads the application form** of each promising role on Greenhouse, Ashby or Lever. A
   "Remote" job whose form asks "Are you authorized to work in the United States?" hires
   only in the US, so it is skipped outright, not just scored down. A question put only to
   US applicants, next to one for everyone else (DuckDuckGo does this), does not count.
7. **Writes a prep pack** for anything scoring 60+: why you fit, which projects to lead with,
   what to be honest about, ATS keywords you lack, drafted answers, and a letter. The answers
   are for the questions the job's own form asks ("What interests you about working at
   Ready?", "What stack are you most experienced with?"), or the usual four when the form
   cannot be read: why us, a project you're proud of, a tough call, your best work. They are
   templates, not AI: stitched from `stories` in `profile.json`, which hold only true facts
   from your resume, and from what the posting says about the company. Personal fields
   (name, salary, visa, links) are left for you. Edit the stories to change every draft.
8. **Shortlists the day**: the top 15 picks found since yesterday, best first and at most two
   per company, plus a top 5 for India-based roles (`picks` in `profile.json`). Every full
   list is folded under them, and the notification lists the same picks. Each job has an
   **Application form** button that opens the form itself, not the job description.

## Tuning

Everything lives in `profile.json`; push a change and the next run uses it.

- `titles.wanted` / `titles.reject` - what counts as your kind of role
- `skills.core` / `skills.differentiators` / `skills.gaps` - keywords and weights
- `eligibility.great` / `good` / `bad` / `notMine` - phrases that decide the geography bucket
- `eligibility.formBlocks` - application-form wording that means US-only (skips the job)
- `eligibility.languages` - languages that, when required, rule a job out
- `excludeCompanies` - companies never to show, by name (case and punctuation ignored)
- `pay.targetUSD` - a stated USD salary reaching this adds to the score. Stated pay is read
  from the posting text too ("$150,000", "$150k")
- WeWorkRemotely and company boards drop a listing when it closes, so their old dates are
  not penalised: a role kept open for months is still open
- `projects` - the lead paragraph and trigger words for each of your projects
- `resumeKeywords` - what your resume already says, used to spot missing ATS keywords
- `thresholds` - when a pack is written, and the strong / worth-a-look cutoffs

## Companies to watch

`companies.json` lists companies whose own boards are fetched on every run. To add one, add
`{ "name": "Acme" }`; the run looks its board up on Ashby, Greenhouse and Lever. When the
lookup lands on the wrong company, or the board is elsewhere, give it explicitly as
`"board": "ats:token"` - `ats` is `ashby`, `greenhouse`, `lever`, `lever-eu` or
`smartrecruiters`, and the token is the slug in the board URL (`jobs.ashbyhq.com/ready` ->
`ashby:ready`). A company with no readable board can carry `"careers": "<url>"`; the report
lists it under **Check by hand**. To see what each entry resolves to and how many jobs it has:

```bash
node src/companies.ts
```

The file is public, like the rest of the repo.

## The report

A tab bar at the top jumps to each section. Sections fold open and shut; the
wrong-geography list and the check-by-hand list start folded. **Based in India** holds roles
located in India (remote, hybrid or office), with its own bar, `thresholds.india` in
`profile.json`; cities and states that count are in `eligibility.indiaPlaces`. A role open in
several countries, India among them, stays in the main lists as a worldwide role. Every time is IST. Each job shows when it was posted (a date: several sources send
only a day) and when this tool first found it (date and time).

## Setup

| Where | Name | What it is |
|---|---|---|
| Vercel - Storage | - | Upstash for Redis, connected to the project. It sets its own credentials, which nothing else ever needs |
| Vercel - Env vars | `REPORT_KEY` | A long random string. Opens the report |
| Vercel - Env vars | `PUBLISH_KEY` | A different long random string. Allows writing |
| Vercel - Env vars | `CRON_SECRET` | A random string. Vercel sends it with each cron call so only its cron can start a run |
| Vercel - Env vars | `GH_DISPATCH_TOKEN` | A fine-grained GitHub token for this repo only, with Actions: Read and write |
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
