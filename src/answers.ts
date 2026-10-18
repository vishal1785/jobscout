/**
 * Drafted answers for an application form, from templates and true facts.
 *
 * The owner asked for the job-related questions ("why us", "a project you are
 * proud of", "a tough call") to be drafted rather than left blank. No AI is
 * involved: each answer is stitched from the stories in profile.json, which
 * hold only facts from the resume and interview prep, plus what this posting
 * itself says. Personal fields (name, salary, visa) are left to him.
 */
import { hasWord, type Scored } from './score.ts';

export type Kind = 'why' | 'proud' | 'best' | 'tough' | 'ambiguity' | 'ai' | 'remote' | 'stack' | 'other';

// fields he fills himself: identity, links, pay, dates, legal and demographic
const PERSONAL = /\b(name|e-?mail|phone|resume|cv|cover letter|linkedin|github|website|portfolio|twitter|links?|social media|profiles?|location|country|city|address|zip|postal|salary|compensation|pay|rate|notice|start date|available|availability|visa|sponsor|authori[sz]ed|eligib|citizen|clearance|how did you hear|referr|pronoun|gender|race|ethnic|veteran|disabilit|consent|privacy|agree|acknowledge|terms|policy|preferred|time ?zone|years of experience|date of birth|age|attestation|confirm|previously (worked|applied)|worked (at|for)|relative|non-?compete|employment agreement|accommodation|adjustment)\b/;

/** What kind of question a form label asks, or null for a personal field. */
export function classify(label: string): Kind | null {
  const l = label.toLowerCase();
  if (/\bwhy\b[^?]{0,60}\b(us|company|role|position|join|interested|apply|applying|want|here|this|team)\b|what (interests|excites|attracts|draws|motivates) you|why do you want|motivat/.test(l)) return 'why';
  if (/\btough|difficult|hard (decision|call|choice)|trade-?off|disagree|conflict|mistake|fail(ed|ure)?\b|went wrong|pushed back/.test(l)) return 'tough';
  if (/ambigu|unclear|little (direction|guidance|oversight)|without (a )?(spec|clear)/.test(l)) return 'ambiguity';
  if (/\b(ai|llm|llms|copilot|claude|chatgpt|cursor|genai|agentic|agents?)\b/.test(l)) return 'ai';
  if (/\bbest work\b|most (impressive|significant)|greatest (achievement|accomplishment)/.test(l)) return 'best';
  if (/proud|accomplishment|achievement|project (you|that)|something you('ve| have)? (built|shipped|made)|tell us about (a|one|your) (project|thing|piece of work)|piece of work|describe a project/.test(l)) return 'proud';
  if (/\b(remote|async|asynchronous|distributed|overlap)\b/.test(l)) return 'remote';
  if (/\b(stack|tech stack|technolog(y|ies)|languages|frameworks)\b/.test(l)) return 'stack';
  if (PERSONAL.test(l)) return null;
  // anything else long-form ("Describe...", "Tell us...", a real question) still gets a starting point
  if (l.length > 25 && (/[?]$/.test(l) || /^(describe|tell|explain|share|what|how|walk)/.test(l))) return 'other';
  return null;
}

const NICE: Record<string, string> = {
  react: 'React', javascript: 'JavaScript', typescript: 'TypeScript', redux: 'Redux', 'next.js': 'Next.js',
  nextjs: 'Next.js', node: 'Node', 'node.js': 'Node', python: 'Python', aws: 'AWS', postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL', fastapi: 'FastAPI', graphql: 'GraphQL', tailwind: 'Tailwind', 'rest api': 'REST APIs',
  llm: 'LLMs', 'ai agent': 'AI agents', agentic: 'agentic systems', claude: 'Claude', openai: 'OpenAI',
  bedrock: 'Bedrock', rag: 'RAG', airflow: 'Airflow', databricks: 'Databricks', 'data pipeline': 'data pipelines',
  elasticsearch: 'Elasticsearch', opensearch: 'OpenSearch', terraform: 'Terraform', docker: 'Docker',
  serverless: 'serverless', lambda: 'Lambda', cloudflare: 'Cloudflare',
};

const GAP_NAMES: Record<string, string> = {
  'ruby on rails': 'Ruby on Rails', rails: 'Rails', kotlin: 'Kotlin', django: 'Django', golang: 'Go',
  'go developer': 'Go', rust: 'Rust', scala: 'Scala', php: 'PHP', laravel: 'Laravel', '.net': '.NET',
  'c#': 'C#', java: 'Java', elixir: 'Elixir', redshift: 'Redshift', kubernetes: 'Kubernetes',
  swift: 'Swift', flutter: 'Flutter',
};

/**
 * One plain sentence on a gap, only when the gap is central to the job: in
 * the title or the opening of the posting. A gap the posting mentions in
 * passing is not worth volunteering.
 */
export function gapLine(job: Scored): string {
  const head = `${job.title} \n ${job.description.slice(0, 600)}`.toLowerCase();
  const central = job.gaps.filter((g) => hasWord(head, g)).map((g) => GAP_NAMES[g] ?? g);
  const names = [...new Set(central)].slice(0, 2);
  if (!names.length) return '';
  return `I haven't used ${list(names).replace(/ and /, ' or ')} in production yet. I pick up stacks quickly: my career has run from Java to Android to React, cloud data platforms and LLM agents.`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A sentence from the posting about what the company does, turned to address
 * them: "We are building X" becomes "you are building X". Only plain, short
 * sentences qualify; anything odd and the draft simply goes without one.
 */
export function missionLine(job: Pick<Scored, 'company' | 'description'>): string | null {
  const company = job.company.toLowerCase();
  const sentences = job.description.slice(0, 2500).split(/(?<=[.!])\s+|\n+/).map((s) => s.trim());
  for (const s of sentences) {
    if (s.length < 40 || s.length > 220 || !/[.!]$/.test(s) || /[:|]|https?:/.test(s)) continue;
    const low = s.toLowerCase();
    let out: string | null = null;
    if (low.startsWith(`${company} is `) || low.startsWith(`${company} builds `) || low.startsWith(`${company} helps `)) {
      // with the company as the subject, "its" is theirs: "Ready is expanding
      // its team" becomes "you are expanding your team"
      out = `you${s.slice(company.length).replace(/^ is /, ' are ').replace(/^ builds /, ' build ').replace(/^ helps /, ' help ')}`
        .replace(/\bits\b/g, 'your');
    } else if (/^(we are|we're|we build|we help|we make|our mission is)\b/i.test(s)) {
      out = s.replace(/^we're\b/i, 'you are').replace(/^we\b/i, 'you').replace(/^our\b/i, 'your');
    }
    if (!out) continue;
    out = out.replace(/\bwe're\b/gi, "you're").replace(/\bwe\b/gi, 'you').replace(/\bour\b/gi, 'your').replace(/\bus\b/gi, 'you');
    return out.replace(/[.!]$/, '');
  }
  return null;
}

/** Projects ranked by how much of this posting they speak to. */
export function rankProjects(job: Scored, profile: any): string[] {
  const text = `${job.title} \n ${job.tags.join(' ')} \n ${job.description}`.toLowerCase();
  return Object.entries<any>(profile.projects)
    .map(([key, p]) => ({ key, hits: p.signals.filter((s: string) => hasWord(text, s)).length }))
    .sort((a, b) => b.hits - a.hits)
    .map((p) => p.key);
}

/**
 * The opening for a letter: why this company and role, without the project
 * line, since the letter tells the project in full a paragraph later.
 */
export function whyOpening(job: Scored, profile: any): string {
  return draft('why', job, profile, false);
}

export function draft(kind: Kind, job: Scored, profile: any, withProject = true): string {
  const s = profile.stories ?? {};
  const ranked = rankProjects(job, profile).filter((k) => s.proud?.[k]);
  const first = s.proud?.[ranked[0]] ?? '';
  const second = s.proud?.[ranked[1]] ?? first;

  switch (kind) {
    case 'why': {
      const skills = [...new Set(job.matched.map((m) => NICE[m] ?? m))].slice(0, 3);
      const mission = missionLine(job);
      // leads open with a name ("Unmarked, ...") or an article ("An autonomous
      // ..."): only the article is lowercased mid-sentence
      const lead = String(profile.projects?.[ranked[0]]?.lead ?? '').replace(/^(A|An|The) /, (m) => m.toLowerCase());
      return [
        mission ? `I read that ${mission}, and that is work I'd like to be part of.` : '',
        skills.length
          // the letter introduces Kynetec in its next paragraph, so only the
          // standalone answer names it here
          ? `This role centres on ${list(skills)}, which is what I do every day${withProject ? ' as a team lead at Kynetec Data Services' : ''}.`
          : 'This role fits how I like to work: owning systems end to end, from architecture to production.',
        withProject && lead ? `The closest thing I've built is ${lead}` : '',
        `I'd bring that mix of hands-on building and technical leadership to ${job.company}.`,
      ].filter(Boolean).join(' ');
    }
    case 'proud': return first;
    case 'best': return second;
    case 'tough': return s.toughCall ?? '';
    case 'ambiguity': return s.ambiguity ?? '';
    case 'ai': return s.ai ?? '';
    case 'remote': return s.remote ?? '';
    case 'stack': return s.stack ?? '';
    case 'other': return `Starting point (closest true story; reshape it to the question): ${first}`;
  }
}

/**
 * The questions to answer, each with a draft: the form's own open questions
 * when it could be read, otherwise the four most forms ask in some wording.
 */
export function draftAnswers(job: Scored, profile: any): Array<{ question: string; kind: Kind; answer: string }> {
  const asked = (job.formQuestions ?? [])
    .map((q) => ({ question: q, kind: classify(q) }))
    .filter((q): q is { question: string; kind: Kind } => q.kind !== null);
  const questions = asked.length ? asked : [
    { question: `Why ${job.company}?`, kind: 'why' as Kind },
    { question: 'Tell us about a project you are proud of.', kind: 'proud' as Kind },
    { question: 'Tell us about a tough call you made.', kind: 'tough' as Kind },
    { question: 'What is your best work?', kind: 'best' as Kind },
  ];
  return questions.map((q) => ({ ...q, answer: draft(q.kind, job, profile) })).filter((q) => q.answer);
}
