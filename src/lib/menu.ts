import { IconMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, type PredefinedMenuItemOptions } from "@tauri-apps/api/menu";
import { sfSymbolImage } from "./sfsymbol";
import { inTauri, isMobile } from "./backend";
import type { Action } from "./QuickOpen.svelte";
import { t, type Key } from "./i18n";

const NAMED: Record<string, string> = { "↩": "Enter", "⌫": "Backspace", "⎋": "Escape" };

/** "⇧⌘Z" → "CmdOrCtrl+Shift+Z" (Tauri accelerator syntax). */
export function accelerator(hint?: string): string | undefined {
  if (!hint) return undefined;
  const parts: string[] = [];
  if (hint.includes("⌘")) parts.push("CmdOrCtrl");
  if (hint.includes("⇧")) parts.push("Shift");
  if (hint.includes("⌥")) parts.push("Alt");
  if (hint.includes("⌃")) parts.push("Ctrl");
  const key = hint.replace(/[⌘⇧⌥⌃]/g, "");
  parts.push(NAMED[key] ?? key.toUpperCase());
  return parts.join("+");
}

/** `Action.menu` values, in menu-bar order, and their displayed titles. */
const SECTIONS = {
  App: "app.name",
  File: "menu.file",
  Edit: "menu.edit",
  Note: "menu.note",
  View: "menu.view",
  Tools: "menu.tools",
} as const satisfies Record<string, Key>;
const ORDER = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];

/** Cheap fingerprint of what the menu would show, to skip needless rebuilds. */
export function menuSignature(actions: Action[]): string {
  return actions
    .filter((a) => a.menu)
    .map((a) => `${a.id}|${a.menuLabel ?? a.label}|${a.enabled !== false}`)
    .join("\n");
}

type Entry = MenuItem | IconMenuItem | PredefinedMenuItem | Submenu;
type Item = Entry | Menu;

/** The live menu: its layout, its items by action id, and every native resource it holds. */
let live: {
  layout: string;
  items: Map<string, { item: MenuItem | IconMenuItem; text: string; enabled: boolean }>;
  resources: Item[];
} | null = null;
/** Latest actions by id, so menu items always run the current closure. */
const current = new Map<string, Action>();
let queue = Promise.resolve();

/** Show the palette actions in the app menu, grouped by `action.menu`; calls run in order. */
export function setAppMenu(actions: Action[]): Promise<void> {
  if (!inTauri || isMobile) return Promise.resolve();
  const run = queue.then(() => apply(actions));
  queue = run.catch(() => {});
  return run;
}

async function apply(actions: Action[]) {
  current.clear();
  for (const a of actions) if (a.menu) current.set(a.id, a);
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const layout = `${dark}|${[...current.values()].map((a) => `${a.menu}|${a.id}|${a.hint}|${a.symbol}`).join("\n")}`;
  // Same items in the same places: only labels and enabled flags changed, so patch those.
  if (live?.layout === layout) {
    const ops: Promise<void>[] = [];
    for (const a of current.values()) {
      const l = live.items.get(a.id)!;
      const text = a.menuLabel ?? a.label;
      const enabled = a.enabled !== false;
      if (l.text !== text) ops.push(l.item.setText((l.text = text)));
      if (l.enabled !== enabled) ops.push(l.item.setEnabled((l.enabled = enabled)));
    }
    await Promise.all(ops);
    return;
  }
  const next = { layout, items: new Map(), resources: [] as Item[] };
  const keep = <T extends Item>(r: T) => (next.resources.push(r), r);
  await build(actions, dark, next.items, keep);
  const old = live;
  live = next;
  // The old menu is no longer shown; free its native items.
  if (old) await Promise.all(old.resources.map((r) => r.close().catch(() => {})));
}

async function build(actions: Action[], dark: boolean, handles: NonNullable<typeof live>["items"], keep: <T extends Item>(r: T) => T) {
  const groups = new Map<string, Action[]>();
  for (const a of actions) {
    if (!a.menu) continue;
    (groups.get(a.menu) ?? groups.set(a.menu, []).get(a.menu)!).push(a);
  }
  // SF Symbols, tinted for the current appearance (the menu bar follows the system).
  const items = async (list: Action[]): Promise<(MenuItem | IconMenuItem)[]> =>
    Promise.all(
      list.map(async (a) => {
        const base = {
          id: a.id,
          text: a.menuLabel ?? a.label,
          accelerator: accelerator(a.hint),
          enabled: a.enabled !== false,
          action: () => current.get(a.id)?.run(),
        };
        const icon = a.symbol ? await sfSymbolImage(a.symbol, dark) : null;
        const item = keep(await (icon ? IconMenuItem.new({ ...base, icon }) : MenuItem.new(base)));
        handles.set(a.id, { item, text: base.text, enabled: base.enabled });
        return item;
      }),
    );

  const native = async (item: PredefinedMenuItemOptions["item"]) => keep(await PredefinedMenuItem.new({ item }));
  const submenu = async (text: string, items: Entry[]) => keep(await Submenu.new({ text, items }));

  // The app menu is native apart from its own actions (Settings…), placed after About.
  const submenus = [
    await submenu(t(SECTIONS.App), [
      await native({ About: null }),
      await native("Separator"),
      ...(await items(groups.get("App") ?? [])),
      await native("Separator"),
      await native("Services"),
      await native("Separator"),
      await native("Hide"),
      await native("HideOthers"),
      await native("ShowAll"),
      await native("Separator"),
      await native("Quit"),
    ]),
  ];
  for (const name of ORDER) {
    if (name === "App") continue;
    const entries: Entry[] = await items(groups.get(name) ?? []);
    if (name === "Edit")
      entries.push(await native("Separator"), await native("Cut"), await native("Copy"), await native("Paste"), await native("SelectAll"));
    if (name === "File") entries.push(await native("Separator"), await native("CloseWindow"));
    if (!entries.length) continue;
    submenus.push(await submenu(t(SECTIONS[name]), entries));
  }
  submenus.push(await submenu(t("menu.window"), [await native("Minimize"), await native("Maximize"), await native("Fullscreen")]));

  const menu = keep(await Menu.new({ items: submenus }));
  await menu.setAsAppMenu();
}
