import { formatClock, formatDay as formatDayIn, formatRelative, type TimeInput } from "purr";
import { t } from "./i18n.ts";
import { parseDue } from "./calendar.ts";

/** `5m ago`, in the platform's locale; only "just now" and the unreadable date are ours. */
export function relative(when: TimeInput): string {
  return formatRelative(when, { justNow: t("time.justNow"), invalid: t("app.dash") });
}

/** `YYYY-MM-DD HH:mm` in local time (commit messages). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A day relative to `today` when close (`Tomorrow`, `Friday`), else its date; years only when not this one. */
export function formatDay(key: string, today: string): string {
  return formatDayIn(key, { today: t("due.today"), tomorrow: t("due.tomorrow"), yesterday: t("due.yesterday") }, today);
}

/** `HH:mm` in the platform's clock style. */
export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return formatClock(new Date(2000, 0, 1, h, m));
}

/** A due value as people read it: `Tomorrow, 09:30`. */
export function formatDue(due: string, today: string): string {
  const d = parseDue(due);
  if (!d) return due;
  const day = formatDay(d.date, today);
  return d.time ? t("due.at", { day, time: formatTime(d.time) }) : day;
}
