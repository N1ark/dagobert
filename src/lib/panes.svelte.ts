import { readJson, writeJson } from "purr";
import { DEFAULT_LAYOUT, repair, type Layout, type Pane } from "./tiles";

const KEY = "dagobert.layout";

/** Where every desktop panel lives, remembered across launches. */
export const layout = $state(repair(readJson(KEY, null)) ?? structuredClone(DEFAULT_LAYOUT));

export const saveLayout = () => writeJson(KEY, $state.snapshot(layout));

export function setLayout(l: Layout) {
  layout.tree = l.tree;
  layout.popups = l.popups;
  saveLayout();
}

/** What a `Dock` reaches its `Tiles` through. */
export type TilesHandle = {
  grab: (e: PointerEvent, pane: Pane) => void;
  toggle: (button: HTMLElement, pane: Pane) => void;
};
export const TILES = Symbol("tiles");

/** What a panel's header reaches its dock through; absent where the panel can't move. */
export type DockHandle = { grab: (e: PointerEvent) => void; toggle: (button: HTMLElement) => void };
export const DOCK = Symbol("dock");
