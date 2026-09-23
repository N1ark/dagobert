/** Split markdown into editable blocks and back. */

const CONFLICT_START = /^<{7} /;
const CONFLICT_MID = /^={7}$/;
const CONFLICT_END = /^>{7} /;
/** Any git conflict marker line. */
export const MARKER_RE = /^(<{7} |={7}$|>{7} )/;

/** Blank lines split blocks, except inside fenced code and git conflict regions. */
export function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let conflict = false;
  for (const line of text.split("\n")) {
    if (conflict) {
      cur.push(line);
      if (CONFLICT_END.test(line)) conflict = false;
      continue;
    }
    if (!fence && CONFLICT_START.test(line)) {
      cur.push(line);
      conflict = true;
      continue;
    }
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      cur.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      cur.push(line);
      continue;
    }
    if (line.trim() === "") {
      if (cur.length) out.push(cur.join("\n"));
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (conflict) {
    // No closing marker: the "region" is ordinary text after all.
    let part: string[] = [];
    for (const line of cur) {
      if (line.trim() === "") {
        if (part.length) out.push(part.join("\n"));
        part = [];
      } else part.push(line);
    }
    cur = part;
  }
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

export function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.trim() !== "").join("\n\n");
}

/** Which sub-block of `text` contains `offset`, and the offset within it. */
export function locate(text: string, offset: number): { index: number; offset: number } {
  const parts = splitBlocks(text);
  if (parts.length <= 1) return { index: 0, offset: Math.min(offset, text.length) };
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const at = text.indexOf(parts[i], pos);
    if (offset <= at + parts[i].length || i === parts.length - 1) {
      return { index: i, offset: Math.max(0, Math.min(parts[i].length, offset - at)) };
    }
    pos = at + parts[i].length;
  }
  return { index: parts.length - 1, offset: parts[parts.length - 1].length };
}

/** Toggle the n-th task checkbox (`[ ]`/`[x]`) in a block. */
export function toggleCheckbox(block: string, nth: number): string {
  let i = -1;
  return block.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm, (m, pre: string, state: string) => {
    i++;
    if (i !== nth) return m;
    return `${pre}[${state === " " ? "x" : " "}]`;
  });
}

/** True when the block is a fenced code block. */
export function isCode(block: string): boolean {
  return /^\s*(```|~~~)/.test(block);
}

/** The line ranges of the conflict region inside a block, if it holds one. */
function region(lines: string[]): { start: number; mid: number; end: number } | null {
  const start = lines.findIndex((l) => CONFLICT_START.test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && CONFLICT_END.test(l));
  if (end < 0) return null;
  const mid = lines.findIndex((l, i) => i > start && i < end && CONFLICT_MID.test(l));
  return { start, mid, end };
}

/** True when the block holds a git conflict region. */
export function isConflict(block: string): boolean {
  return region(block.split("\n")) !== null;
}

/** The block as each side wrote it (text around the region included), without the marker lines. */
export function conflictSides(block: string): { mine: string; theirs: string } {
  const lines = block.split("\n");
  const r = region(lines);
  if (!r) return { mine: block, theirs: block };
  const before = lines.slice(0, r.start);
  const after = lines.slice(r.end + 1);
  const mine = lines.slice(r.start + 1, r.mid < 0 ? r.end : r.mid);
  const theirs = r.mid < 0 ? [] : lines.slice(r.mid + 1, r.end);
  return {
    mine: [...before, ...mine, ...after].join("\n"),
    theirs: [...before, ...theirs, ...after].join("\n"),
  };
}

/** Replace the conflict region of a block by one side, or both in order. */
export function resolveConflict(block: string, keep: "mine" | "theirs" | "both"): string {
  const lines = block.split("\n");
  const r = region(lines);
  if (!r) return block;
  const before = lines.slice(0, r.start);
  const after = lines.slice(r.end + 1);
  const mine = lines.slice(r.start + 1, r.mid < 0 ? r.end : r.mid).join("\n");
  const theirs = r.mid < 0 ? "" : lines.slice(r.mid + 1, r.end).join("\n");
  let middle: string;
  if (keep === "mine") middle = mine;
  else if (keep === "theirs") middle = theirs;
  // A standalone region becomes two paragraphs, so one side's list can't swallow the other.
  else middle = [mine, theirs].filter((s) => s.trim()).join(before.length || after.length ? "\n" : "\n\n");
  return [...before, ...(middle ? [middle] : []), ...after].join("\n");
}

/** The body without git conflict marker lines (for search, links, previews). */
export function stripMarkers(text: string): string {
  return text
    .split("\n")
    .filter((l) => !MARKER_RE.test(l))
    .join("\n");
}
