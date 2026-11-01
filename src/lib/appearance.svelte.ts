/** This machine's look (theme, accent, completed notes' opacity), in localStorage for every window. */
import { ACCENTS, applyTheme, readJson, writeJson, type ThemeMode } from "purr";
import { backend } from "./backend";

const KEY = "dagobert.appearance";

export interface Appearance {
  theme: ThemeMode;
  accent: string;
  doneOpacity: number;
}

export const DONE_OPACITY = { min: 0.1, max: 1, initial: 0.55 };

function read(): Appearance {
  const v = readJson<Partial<Appearance>>(KEY, {}, (x): x is Partial<Appearance> => !!x && typeof x === "object");
  const opacity = typeof v.doneOpacity === "number" ? v.doneOpacity : DONE_OPACITY.initial;
  return {
    theme: v.theme === "system" || v.theme === "light" ? v.theme : "dark",
    accent: ACCENTS.some((a) => a.id === v.accent) ? v.accent! : ACCENTS[0].id,
    doneOpacity: Math.min(DONE_OPACITY.max, Math.max(DONE_OPACITY.min, opacity)),
  };
}

export const appearance: Appearance = $state(read());

let native: ThemeMode | null = null;
function paint() {
  applyTheme({ mode: appearance.theme, accent: appearance.accent });
  document.documentElement.style.setProperty("--done-opacity", String(appearance.doneOpacity));
  if (native !== appearance.theme) backend.setAppTheme((native = appearance.theme));
}

/** Shows a change in this window only, e.g. while a slider moves; `setAppearance` keeps it. */
export function previewAppearance(patch: Partial<Appearance>) {
  Object.assign(appearance, patch);
  paint();
}

export function setAppearance(patch: Partial<Appearance> = {}) {
  previewAppearance(patch);
  writeJson(KEY, $state.snapshot(appearance));
  backend.announceAppearance();
}

/** Paints the stored look and follows changes made in other windows; runs before mounting. */
export function startAppearance() {
  paint();
  const reload = () => previewAppearance(read());
  window.addEventListener("storage", (e) => e.key === KEY && reload());
  backend.onAppearance(reload);
}
