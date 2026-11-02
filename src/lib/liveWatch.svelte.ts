/** A value the live preview drew from app state (a link's target, a repo alias), and what it was then. */
export interface Watched {
  read: () => string;
  seen: string;
}

/** Calls `onchange` (in a microtask) once any watched value reads differently from what was drawn. */
export function watcher(onchange: () => void) {
  let watched = $state.raw<Map<string, Watched>>(new Map());
  let queued = false;
  const stop = $effect.root(() => {
    $effect(() => {
      let changed = false;
      for (const w of watched.values()) if (w.read() !== w.seen) changed = true;
      if (!changed || queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        onchange();
      });
    });
  });
  return {
    /** What the latest drawing depended on; a set equal to the last one changes nothing. */
    set(next: Map<string, Watched>) {
      if (next.size === watched.size && [...next].every(([k, w]) => watched.get(k)?.seen === w.seen)) return;
      watched = next;
    },
    stop,
  };
}
