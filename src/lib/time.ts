import { formatRelative, type TimeInput } from "purr";
import { t } from "./i18n.ts";

/** `5m ago`, in the platform's locale; only "just now" and the unreadable date are ours. */
export function relative(when: TimeInput): string {
  return formatRelative(when, { justNow: t("time.justNow"), invalid: t("app.dash") });
}

/** `YYYY-MM-DD HH:mm` in local time (commit messages). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
