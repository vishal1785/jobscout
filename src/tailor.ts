/**
 * Per-job preparation pack.
 *
 * The facts worth leading with, the keywords an ATS will look for, the gaps to
 * be honest about, drafted answers to the form's own questions, and a letter.
 * Until Oct 2026 the letter's opening was a deliberate blank for him to write;
 * he asked for it drafted instead, so it is now stitched from templates and
 * true stories (see answers.ts). Nothing is invented and nothing is submitted.
 */
import { hasWord, type Scored } from './score.ts';
import { istDate, istDateTime } from './time.ts';
import { draft, draftAnswers, whyOpening, gapLine } from './answers.ts';
import { applyLink } from './forms.ts';

export function buildPack(job: Scored, profile: any): string {
  const text = `${job.title} \n ${job.tags.join(' ')} \n ${job.description}`.toLowerCase();

  // which projects to lead with, ranked by how many of their signals this job hits
  const projects = Object.entries<any>(profile.projects)
    .map(([key, p]) => ({
      key,
      lead: p.lead,
      hits: p.signals.filter((s: string) => hasWord(text, s)),
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
    .filter((kw) => hasWord(text, kw))
    .filter((kw) => !profile.resumeKeywords.some((r: string) => r.includes(kw) || kw.includes(r)));

  const date = istDateTime(Date.now());
  const salary = job.salary ? `\n- **Salary stated:** ${job.salary}` : '';
  const form = applyLink(job);
  const answers = draftAnswers(job, profile);
  const why = whyOpening(job, profile);
  const proof = draft('proud', job, profile);
  const gap = gapLine(job);

  return `# ${job.company} - ${job.title}

- **Link:** ${job.url}${job.directUrl ? `
- **Apply direct:** ${job.directUrl}` : ''}${form ? `
- **Application form:** ${form}` : ''}
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

## Drafted answers
${job.formQuestions?.length ? '_The questions below are the ones this form asks._' : '_The form could not be read, so these are the four questions most forms ask in some wording._'}

${answers.map((a) => `**${a.question}**\n\n${a.answer}`).join('\n\n')}

## Letter

Dear ${job.company} team,

I'm applying for the ${job.title} role. ${why}

${profile.stories?.intro ?? ''}

${proof}
${gap ? `\n${gap}\n` : ''}
${profile.stories?.remote ?? ''}

Best regards,
Vishal Bhardwaj

## Before you send
- [ ] Read the drafts once: every fact must be true of you, and the opening must make sense for this company
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
