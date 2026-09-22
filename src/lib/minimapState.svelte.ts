/** Whether the minimap is showing. Shared because the toggle lives in the
 *  toolbar on mobile, while the map itself is drawn inside the canvas. */
const KEY = "dagobert.minimap";

export const minimap = $state({ open: localStorage.getItem(KEY) !== "0" });

export function toggleMinimap() {
  minimap.open = !minimap.open;
  try {
    localStorage.setItem(KEY, minimap.open ? "1" : "0");
  } catch {}
}
