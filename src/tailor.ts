/**
 * Per-job preparation pack.
 *
 * Deliberately NOT a finished cover letter. It gives the facts worth leading
 * with, the keywords an ATS will look for, the gaps to be honest about, and a
 * skeleton with a blank where your own reason for wanting this job goes.
 * A letter that reads as generated gets binned; one specific sentence from you
 * is worth more than three polished paragraphs from a machine.
 */
import type { Scored } from './score.ts';
import { istDate, istDateTime } from './time.ts';

export function buildPack(job: Scored, profile: any): string {
  const text = `${job.title} \n ${job.tags.join(' ')} \n ${job.description}`.toLowerCase();

  // which projects to lead with, ranked by how many of their signals this job hits
  const projects = Object.entries<any>(profile.projects)
    .map(([key, p]) => ({
      key,
      lead: p.lead,
      hits: p.signals.filter((s: string) => text.includes(s)),
    }))
    .sort((a, b) => b.hits.length - a.hits.length)
    .filter((p, i) => p.hits.length > 0 || i < 2)
    .slice(0, 3);

  // ATS keywords the posting uses that your resume does not
  const postingWords = new Set(
    (text.match(/[a-z][a-z0-9+#.\-]{2,}/g) ?? []).map((w) => w.replace(/[.,]$/, ''))
  );
  const missing = (profile.skills.core ? Object.keys(profile.skills.core) : [])
    .concat(Object.keys(profile.skills.differentiators))
    .concat(['kubernetes', 'graphql', 'microservices', 'ci/cd', 'rest', 'websockets', 'redis', 'mongodb', 'figma', 'accessibility', 'testing', 'playwright', 'jest', 'vitest'])
    .filter((kw) => text.includes(kw))
    .filter((kw) => !profile.resumeKeywords.some((r: string) => r.includes(kw) || kw.includes(r)));

  const date = istDateTime(Date.now());
  const salary = job.salary ? `\n- **Salary stated:** ${job.salary}` : '';

  return `# ${job.company} - ${job.title}

- **Link:** ${job.url}${job.directUrl ? `
- **Apply direct:** ${job.directUrl}` : ''}
- **Source:** ${job.source}
- **Location:** ${job.location}
- **Eligibility:** ${job.eligibility} (${job.eligibilityWhy})
- **Score:** ${job.score}/100
- **Posted:** ${istDate(job.postedAt) || 'unknown'}${salary}
- **Pack written:** ${date}

## Why you fit
${job.matched.length ? job.matched.map((m) => `- ${m}`).join('\n') : '- (no strong keyword overlap - check the posting before spending time)'}

## Lead with
${projects.map((p) => `- **${p.key}** ${p.hits.length ? `(matches: ${p.hits.join(', ')})` : ''}\n  ${p.lead}`).join('\n')}

## Be honest about
${job.gaps.length ? job.gaps.map((g) => `- ${g} - not on your resume. State it in one sentence and move on.`).join('\n') : '- No obvious stack gaps in this posting.'}

## ATS keywords in the posting that your resume lacks
${missing.length ? missing.map((k) => `- ${k}`).join('\n') : '- None worth adding.'}

> Only add a keyword if it is genuinely true of your experience. A keyword you
> cannot defend in an interview costs more than it gains.

## Letter skeleton

Dear ${job.company} team,

I'm applying for the ${job.title} role. **[YOUR HOOK: one or two sentences, in your own
words, on why this company. Something specific - their product, their customers, a
decision they have made. If you cannot write this honestly, skip the application.]**

I'm a full-stack engineer with 15+ years of experience, currently team lead at Kynetec
Data Services, working across React and TypeScript, Python services and AWS data platforms.

**[PROOF: pick one project above and tell it as a story - what the problem was, what you
decided, what happened.]**

**[GAP, if any: one sentence, plainly.]**

I work remotely from India with teams and clients across the US and UK, so async,
written-first collaboration is how I already operate.

Best regards,
Vishal Bhardwaj

## Before you send
- [ ] Hook written in your own words, specific to them
- [ ] Checked the role is still open on their own careers page
- [ ] Checked whether they hire from India (eligibility above is a guess from the text)
- [ ] Resume PDF attached, resume.txt used for any paste-as-text field
- [ ] Portfolio field: https://get-unmarked.vercel.app/join/SCOUT-7PWPC
- [ ] Logged in cover-letter.md
`;
}

export function slug(job: Scored): string {
  return `${job.company}-${job.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}
