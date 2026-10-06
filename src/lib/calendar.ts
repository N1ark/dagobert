/** Due dates: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm`, in local wall-clock time (no zone, so a synced project never shifts). */

export type DueState = "overdue" | "today" | "soon";

const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
const p2 = (n: number) => String(n).padStart(2, "0");

/** A due value's day and optional time, or null when it isn't one. */
export function parseDue(due: string | null | undefined): { date: string; time: string | null } | null {
  const m = due ? DUE_RE.exec(due) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const at = new Date(+y, +mo - 1, +d);
  if (at.getMonth() !== +mo - 1 || at.getDate() !== +d) return null;
  if (h !== undefined && (+h > 23 || +mi > 59)) return null;
  return { date: `${y}-${mo}-${d}`, time: h === undefined ? null : `${h}:${mi}` };
}

export function joinDue(date: string, time: string | null): string {
  return time ? `${date}T${time}` : date;
}

/** The local day of `d` as `YYYY-MM-DD`. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Calendar days from `a` to `b` (DST-proof). */
export function daysBetween(a: string, b: string): number {
  const [x, y] = [a, b].map((k) => {
    const [yy, mm, dd] = k.split("-").map(Number);
    return Date.UTC(yy, mm - 1, dd);
  });
  return Math.round((y - x) / 86_400_000);
}

/** Moves a due value to another day, keeping its time. */
export function moveDue(due: string, date: string): string {
  return joinDue(date, parseDue(due)?.time ?? null);
}

/** Whether a not-done note due at `due` is late, due today or due within the week. */
export function dueState(due: string | null | undefined, done: boolean, now: Date): DueState | null {
  const d = parseDue(due);
  if (!d || done) return null;
  const today = dayKey(now);
  if (d.date < today) return "overdue";
  if (d.date === today) return d.time && d.time <= `${p2(now.getHours())}:${p2(now.getMinutes())}` ? "overdue" : "today";
  return daysBetween(today, d.date) <= 7 ? "soon" : null;
}

/** Sort order: by day, all-day first, then by time. */
export function compareDue(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `due` lands after `before`'s day (and time, when both have one), so `before` can't be met in order. */
export function isLater(due: string, before: string): boolean {
  const a = parseDue(due),
    b = parseDue(before);
  if (!a || !b) return false;
  if (a.date !== b.date) return a.date > b.date;
  return !!a.time && !!b.time && a.time > b.time;
}

/** Items grouped by their day, each day's items in due order. */
export function groupByDay<T>(items: T[], dueOf: (item: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const dated = items
    .map((item) => ({ item, due: dueOf(item), d: parseDue(dueOf(item)) }))
    .filter((x) => x.d)
    .sort((a, b) => compareDue(a.due!, b.due!));
  for (const { item, d } of dated) {
    const list = out.get(d!.date);
    if (list) list.push(item);
    else out.set(d!.date, [item]);
  }
  return out;
}
