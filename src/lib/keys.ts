/**
 * Keyboard shortcuts, in display form (`⇧⌘K`). Strings in the locale never spell
 * them out; they take a placeholder filled from here. `menu.ts` turns them into
 * accelerators, `matches` checks a `KeyboardEvent` against one.
 */
export const keys = {
  "new-note": "⌘N",
  "open-folder": "⌘O",
  "git-sync": "⌘S",
  settings: "⌘,",
  undo: "⌘Z",
  redo: "⇧⌘Z",
  duplicate: "⌘D",
  "quick-open": "⌘K",
  commands: "⇧⌘K",
  search: "⌘F",
  prs: "⇧⌘P",
  "select-all": "⌘A",
  copy: "⌘C",
  paste: "⌘V",
  "open-window": "⌘↩",
  escape: "Esc",
  "nav-deps": "←",
  "nav-dependents": "→",
  "nav-up": "↑",
  "nav-down": "↓",
  "nav-next": "⇥",
  "nav-prev": "⇧⇥",
  "edit-title": "↩",
  bold: "⌘B",
  italic: "⌘I",
  code: "⌘E",
  "code-alt": "⌘`",
  link: "⌘K",
  strike: "⇧⌘X",
  highlight: "⌘H",
} satisfies Record<string, string>;

export type KeyId = keyof typeof keys;

const NAMED: Record<string, string> = {
  "↩": "enter",
  esc: "escape",
  "⌫": "backspace",
  "⇥": "tab",
  "←": "arrowleft",
  "→": "arrowright",
  "↑": "arrowup",
  "↓": "arrowdown",
};

/** Does `e` press the shortcut `hint` (`⌘` accepts Ctrl too, as everywhere in the app)? */
export function matches(hint: string, e: KeyboardEvent): boolean {
  const key = hint.replace(/[⌘⇧⌥⌃]/g, "").toLowerCase();
  if ((NAMED[key] ?? key) !== e.key.toLowerCase()) return false;
  const mod = hint.includes("⌘") || hint.includes("⌃");
  if (mod !== (e.metaKey || e.ctrlKey)) return false;
  return hint.includes("⇧") === e.shiftKey && hint.includes("⌥") === e.altKey;
}
