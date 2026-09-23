/** Whether the minimap is showing; shared, because on mobile the toggle sits in the toolbar. */
const KEY = "dagobert.minimap";

export const minimap = $state({ open: localStorage.getItem(KEY) !== "0" });

export function toggleMinimap() {
  minimap.open = !minimap.open;
  try {
    localStorage.setItem(KEY, minimap.open ? "1" : "0");
  } catch {}
}
