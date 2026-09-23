import type { Note } from "./types";

/** One note's change; a null side means it didn't exist, `trashFile` says where a deletion went. */
export interface NoteDiff {
  id: string;
  before: Note | null;
  after: Note | null;
  trashFile?: string;
}

export interface Entry {
  label: string;
  diffs: NoteDiff[];
  at: number;
}

/** Fields that change without meaning a user edit happened. */
const IGNORED: (keyof Note)[] = ["modified", "file"];

export function sameNote(a: Note | null, b: Note | null): boolean {
  if (a === null || b === null) return a === b;
  for (const k of Object.keys({ ...a, ...b }) as (keyof Note)[]) {
    if (IGNORED.includes(k)) continue;
    const x = a[k],
      y = b[k];
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
    } else if ((x ?? null) !== (y ?? null)) return false;
  }
  return true;
}

/** True when the two snapshots differ only in `body`/`title` (typing). */
function isTyping(a: Note | null, b: Note | null): boolean {
  if (!a || !b) return false;
  return sameNote({ ...a, body: "", title: "" }, { ...b, body: "", title: "" });
}

export class History {
  undo: Entry[] = [];
  redo: Entry[] = [];
  cap: number;
  constructor(cap = 200) {
    this.cap = cap;
  }

  /** Push an entry; consecutive typing on the same note within `coalesceMs` merges. */
  push(entry: Entry, coalesceMs = 1500): Entry | null {
    entry.diffs = entry.diffs.filter((d) => !sameNote(d.before, d.after));
    if (!entry.diffs.length) return null;
    this.redo = [];
    const last = this.undo[this.undo.length - 1];
    if (
      last &&
      entry.diffs.length === 1 &&
      last.diffs.length === 1 &&
      last.diffs[0].id === entry.diffs[0].id &&
      entry.at - last.at < coalesceMs &&
      isTyping(last.diffs[0].before, last.diffs[0].after) &&
      isTyping(entry.diffs[0].before, entry.diffs[0].after)
    ) {
      last.diffs[0].after = entry.diffs[0].after;
      last.at = entry.at;
      return last;
    }
    this.undo.push(entry);
    if (this.undo.length > this.cap) this.undo.shift();
    return entry;
  }

  popUndo(): Entry | undefined {
    const e = this.undo.pop();
    if (e) this.redo.push(e);
    return e;
  }

  popRedo(): Entry | undefined {
    const e = this.redo.pop();
    if (e) this.undo.push(e);
    return e;
  }

  clear() {
    this.undo = [];
    this.redo = [];
  }
}
