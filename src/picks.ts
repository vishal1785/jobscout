/**
 * The short list the morning is for.
 *
 * A full run finds a hundred or more jobs worth something, which nobody can
 * read before work, let alone apply to. The picks are the few worth acting on
 * today: first found in the last 20 hours, best score first, and no more than
 * two from one company so a big hirer cannot fill the list. India-based roles
 * get their own short list, so neither kind crowds out the other.
 */
import type { Scored } from './score.ts';

// 20 hours covers the morning run and GitHub's backup run hours later (which
// finds nothing new, and must not empty the list), but never yesterday's run,
// even with the cron firing anywhere in its hour
const WINDOW_MS = 20 * 3_600_000;

export function todaysPicks(
  jobs: Scored[], seen: Record<string, string>, profile: any, now = Date.now(),
): { world: Scored[]; india: Scored[] } {
  const cfg = profile.picks ?? {};
  const perCompany: number = cfg.perCompany ?? 2;
  const fresh = jobs.filter((j) => now - Date.parse(seen[j.id] ?? '') <= WINDOW_MS);
  const best = (a: Scored, b: Scored) => b.score - a.score || Date.parse(b.postedAt) - Date.parse(a.postedAt);

  const top = (list: Scored[], n: number) => {
    const count = new Map<string, number>();
    const out: Scored[] = [];
    for (const j of [...list].sort(best)) {
      const k = j.company.toLowerCase().trim();
      if ((count.get(k) ?? 0) >= perCompany) continue;
      count.set(k, (count.get(k) ?? 0) + 1);
      out.push(j);
      if (out.length >= n) break;
    }
    return out;
  };

  const { worthALook, india } = profile.thresholds;
  return {
    world: top(fresh.filter((j) => j.eligibility !== 'india' && j.score >= worthALook), cfg.worldwide ?? 15),
    india: top(fresh.filter((j) => j.eligibility === 'india' && j.score >= (india ?? worthALook)), cfg.india ?? 5),
  };
}
