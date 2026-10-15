/**
 * Every time shown is Indian Standard Time. The run happens on a UTC machine,
 * so the zone is set explicitly rather than taken from wherever it runs.
 */
const IST = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false });

const parse = (d: string | number | Date) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t;
};

/** "15 Oct 2026", or '' when the date cannot be read. */
export function istDate(d: string | number | Date): string {
  const t = parse(d);
  return t ? dateFmt.format(t) : '';
}

/** "15 Oct 2026, 07:42 IST", or '' when the date cannot be read. */
export function istDateTime(d: string | number | Date): string {
  const t = parse(d);
  return t ? `${dateFmt.format(t)}, ${timeFmt.format(t)} IST` : '';
}
