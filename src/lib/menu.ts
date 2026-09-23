import { IconMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { sfSymbolImage } from "./sfsymbol";
import { inTauri, isMobile } from "./backend";
import type { Action } from "./QuickOpen.svelte";
import { t, type Key } from "./i18n";

/** "⇧⌘Z" → "CmdOrCtrl+Shift+Z" (Tauri accelerator syntax). */
export function accelerator(hint?: string): string | undefined {
  if (!hint) return undefined;
  const parts: string[] = [];
  if (hint.includes("⌘")) parts.push("CmdOrCtrl");
  if (hint.includes("⇧")) parts.push("Shift");
  if (hint.includes("⌥")) parts.push("Alt");
  if (hint.includes("⌃")) parts.push("Ctrl");
  const key = hint.replace(/[⌘⇧⌥⌃]/g, "");
  const named: Record<string, string> = { "↩": "Enter", "⌫": "Backspace", "⎋": "Escape" };
  parts.push(named[key] ?? key.toUpperCase());
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

/** Rebuild the app menu from the palette actions, grouped by `action.menu`. */
export async function setAppMenu(actions: Action[]) {
  if (!inTauri || isMobile) return;
  const groups = new Map<string, Action[]>();
  for (const a of actions) {
    if (!a.menu) continue;
    (groups.get(a.menu) ?? groups.set(a.menu, []).get(a.menu)!).push(a);
  }
  // SF Symbols, tinted for the current appearance (the menu bar follows the system).
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const items = async (list: Action[]): Promise<(MenuItem | IconMenuItem | PredefinedMenuItem)[]> =>
    Promise.all(
      list.map(async (a) => {
        const base = {
          id: a.id,
          text: a.menuLabel ?? a.label,
          accelerator: accelerator(a.hint),
          enabled: a.enabled !== false,
          action: () => a.run(),
        };
        const icon = a.symbol ? await sfSymbolImage(a.symbol, dark) : null;
        return icon ? IconMenuItem.new({ ...base, icon }) : MenuItem.new(base);
      }),
    );

  // The app menu is native apart from its own actions (Settings…), placed after About.
  const app = await Submenu.new({
    text: t(SECTIONS.App),
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      ...(await items(groups.get("App") ?? [])),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Services" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const submenus = [app];
  for (const name of ORDER) {
    if (name === "App") continue;
    const list = groups.get(name) ?? [];
    const entries = await items(list);
    if (name === "Edit") {
      entries.push(
        await PredefinedMenuItem.new({ item: "Separator" }),
        await PredefinedMenuItem.new({ item: "Cut" }),
        await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }),
        await PredefinedMenuItem.new({ item: "SelectAll" }),
      );
    }
    if (name === "File") {
      entries.push(await PredefinedMenuItem.new({ item: "Separator" }), await PredefinedMenuItem.new({ item: "CloseWindow" }));
    }
    if (!entries.length) continue;
    submenus.push(await Submenu.new({ text: t(SECTIONS[name]), items: entries }));
  }
  submenus.push(
    await Submenu.new({
      text: t("menu.window"),
      items: [
        await PredefinedMenuItem.new({ item: "Minimize" }),
        await PredefinedMenuItem.new({ item: "Maximize" }),
        await PredefinedMenuItem.new({ item: "Fullscreen" }),
      ],
    }),
  );

  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
}
