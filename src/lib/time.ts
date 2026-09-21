import { t } from "./i18n.ts";

export function relative(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return t("app.dash");
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.minutes", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.hours", { n: h });
  const d = Math.round(h / 24);
  if (d < 30) return t("time.days", { n: d });
  const mo = Math.round(d / 30);
  if (mo < 12) return t("time.months", { n: mo });
  return t("time.years", { n: Math.round(mo / 12) });
}

export function absolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** `YYYY-MM-DD HH:mm` in local time (commit messages). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
