import en from "./locales/en.ts";

export type Strings = typeof en;
export type Key = keyof Strings;
type Stem<K> = K extends `${infer S}.other` ? S : never;
type After<K, P extends string> = K extends `${P}${infer R}` ? R : never;
/** Keys that come in `.one` / `.other` pairs, usable with `plural`. */
export type PluralKey = Stem<Key>;
/** Undo-history labels (`history.<label>` in the catalogue). */
export type HistoryLabel = After<Key, "history.">;

export const locale = "en";
const rules = new Intl.PluralRules(locale);

type Vars = Record<string, string | number>;

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** The string for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: Key, vars?: Vars): string {
  return fill(en[key], vars);
}

/** Picks `key.one` / `key.other` for `n`; `{n}` is filled in automatically. */
export function plural(key: PluralKey, n: number, vars?: Vars): string {
  const k = `${key}.${rules.select(n)}` as Key;
  return fill(en[k] ?? en[`${key}.other` as Key], { n, ...vars });
}
