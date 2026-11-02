/** Split markdown into editable blocks and back. */

const CONFLICT_START = /^<{7} /;
const CONFLICT_MID = /^={7}$/;
const CONFLICT_END = /^>{7} /;
/** Any git conflict marker line. */
export const MARKER_RE = /^(<{7} |={7}$|>{7} )/;

/** A list item's marker: its indent, the marker, the spaces after it. */
const ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;

const width = (ws: string) => ws.replace(/\t/g, "    ").length;

/** Blank lines split blocks, except inside fenced code, git conflict regions and before a paragraph indented under a list item. */
export function splitBlocks(text: string): string[] {
  const lines = text.split("\n");
  const plain = new Set<number>();
  for (;;) {
    const r = split(lines, plain);
    if (typeof r !== "number") return r;
    // No closing marker: that "region" is ordinary text after all.
    plain.add(r);
  }
}

/** The blocks, or the line of a conflict region that never closes; conflict starts at `plain` lines are text. */
function split(lines: string[], plain: Set<number>): string[] | number {
  const out: string[] = [];
  let cur: string[] = [];
  let blank: string[] = [];
  let fence: string | null = null;
  let conflict = -1;
  /** Where the text of the current block's outermost list items starts. */
  let list: number | null = null;
  const continues = (line: string) => list !== null && width(/^[ \t]*/.exec(line)![0]) >= list;
  for (const [i, line] of lines.entries()) {
    if (conflict >= 0) {
      cur.push(line);
      if (CONFLICT_END.test(line)) conflict = -1;
      continue;
    }
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      cur.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (line.trim() === "") {
      if (cur.length) blank.push(line);
      continue;
    }
    if (blank.length && continues(line)) cur.push(...blank);
    else if (blank.length) {
      out.push(cur.join("\n"));
      cur = [];
      list = null;
    }
    blank = [];
    cur.push(line);
    if (CONFLICT_START.test(line) && !plain.has(i)) conflict = i;
    else if (f) fence = f[1];
    else {
      const m = ITEM_RE.exec(line);
      const at = m ? width(m[1]) : 0;
      if (m && (list === null || at < list)) {
        const gap = m[3] ? width(m[3]) : 1;
        list = Math.min(list ?? Infinity, at + m[2].length + (gap > 4 ? 1 : gap));
      }
    }
  }
  if (conflict >= 0) return conflict;
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

export function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.trim() !== "").join("\n\n");
}

/** Offsets of the blocks holding a git conflict region (each with the paragraph around it), as `splitBlocks` sees them. */
export function conflictSpans(text: string): { from: number; to: number }[] {
  if (!/^<{7} /m.test(text)) return [];
  const out: { from: number; to: number }[] = [];
  let pos = 0;
  for (const block of splitBlocks(text)) {
    const at = text.indexOf(block, pos);
    if (isConflict(block)) out.push({ from: at, to: at + block.length });
    pos = at + block.length;
  }
  return out;
}

/** Each line of `text` without up to `n` leading spaces or tabs (code nested in a list item, at the margin). */
export function dedent(text: string, n: number): string {
  if (n <= 0) return text;
  const re = new RegExp(`^[ \\t]{0,${n}}`, "gm");
  return text.replace(re, "");
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

/** The lines around the conflict region and each side's lines inside it, markers dropped. */
function parts(block: string): { before: string[]; mine: string[]; theirs: string[]; after: string[] } | null {
  const lines = block.split("\n");
  const r = region(lines);
  if (!r) return null;
  return {
    before: lines.slice(0, r.start),
    mine: lines.slice(r.start + 1, r.mid < 0 ? r.end : r.mid),
    theirs: r.mid < 0 ? [] : lines.slice(r.mid + 1, r.end),
    after: lines.slice(r.end + 1),
  };
}

/** The block as each side wrote it (text around the region included), without the marker lines. */
export function conflictSides(block: string): { mine: string; theirs: string } {
  const p = parts(block);
  if (!p) return { mine: block, theirs: block };
  return {
    mine: [...p.before, ...p.mine, ...p.after].join("\n"),
    theirs: [...p.before, ...p.theirs, ...p.after].join("\n"),
  };
}

/** Replace the conflict region of a block by one side, or both in order. */
export function resolveConflict(block: string, keep: "mine" | "theirs" | "both"): string {
  const p = parts(block);
  if (!p) return block;
  const { before, after } = p;
  const mine = p.mine.join("\n");
  const theirs = p.theirs.join("\n");
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
