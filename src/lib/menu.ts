import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { inTauri } from "./backend";
import type { Action } from "./QuickOpen.svelte";

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

const ORDER = ["File", "Edit", "Note", "View", "Tools"];

/** Cheap fingerprint of what the menu would show, to skip needless rebuilds. */
export function menuSignature(actions: Action[]): string {
  return actions
    .filter((a) => a.menu)
    .map((a) => `${a.id}|${a.menuLabel ?? a.label}|${a.enabled !== false}`)
    .join("\n");
}

/**
 * Replace the app menu with one built from the palette actions, grouped by
 * `action.menu`. The Edit menu keeps the native clipboard items so text
 * editing keeps working in the webview.
 */
export async function setAppMenu(actions: Action[]) {
  if (!inTauri) return;
  const groups = new Map<string, Action[]>();
  for (const a of actions) {
    if (!a.menu) continue;
    (groups.get(a.menu) ?? groups.set(a.menu, []).get(a.menu)!).push(a);
  }
  const items = async (list: Action[]): Promise<(MenuItem | PredefinedMenuItem)[]> =>
    Promise.all(
      list.map((a) =>
        MenuItem.new({
          id: a.id,
          text: a.menuLabel ?? a.label,
          accelerator: accelerator(a.hint),
          enabled: a.enabled !== false,
          action: () => a.run(),
        }),
      ),
    );

  const app = await Submenu.new({
    text: "Dagobert",
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
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
    submenus.push(await Submenu.new({ text: name, items: entries }));
  }
  submenus.push(
    await Submenu.new({
      text: "Window",
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
