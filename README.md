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

1. **Collects** from RemoteOK, Remotive, Himalayas and We Work Remotely, plus any company
   boards listed in `watchlist.json` (Ashby, Greenhouse and Lever are supported). All public
   endpoints, no logins, no bot-evasion. A dead source is logged and skipped.
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
