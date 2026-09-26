import { DEFAULT_LAYOUT, valid, type Layout, type Pane } from "./tiles";

const KEY = "dagobert.layout";

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (valid(saved)) return saved;
  } catch {}
  return structuredClone(DEFAULT_LAYOUT);
}

/** Where every desktop panel lives, remembered across launches. */
export const layout = $state(load());

export function saveLayout() {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(layout)));
  } catch {}
}

export function setLayout(l: Layout) {
  layout.tree = l.tree;
  layout.popups = l.popups;
  saveLayout();
}

/** What a `Dock` reaches its `Tiles` through. */
export type TilesHandle = {
  grab: (e: PointerEvent, pane: Pane) => void;
  toggle: (button: HTMLElement, pane: Pane) => void;
  readonly menu: Pane | null;
};
export const TILES = Symbol("tiles");

/** What a panel's header reaches its dock through; absent where the panel can't move. */
export type DockHandle = { grab: (e: PointerEvent) => void; toggle: (button: HTMLElement) => void; readonly open: boolean };
export const DOCK = Symbol("dock");
