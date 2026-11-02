/** Split markdown into editable blocks and back. */

const CONFLICT_START = /^<{7} /;
const CONFLICT_MID = /^={7}$/;
const CONFLICT_END = /^>{7} /;
/** Any git conflict marker line. */
export const MARKER_RE = /^(<{7} |={7}$|>{7} )/;

/** A list item's marker: its indent, the marker, the spaces after it. */
const ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/;

const width = (ws: string) => ws.replace(/\t/g, "    ").length;

/** Blank lines split blocks, except inside fenced code, git conflict regions and lists (a loose item, an indented paragraph). */
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
  /** Where the text of the current block's outermost list items starts, and that list's marker kind. */
  let list = null as { indent: number; kind: string } | null;
  const continues = (line: string) => {
    if (!list) return false;
    if (width(/^[ \t]*/.exec(line)![0]) >= list.indent) return true;
    const m = ITEM_RE.exec(line);
    return !!m && kindOf(m[2]) === list.kind;
  };
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
      if (m && (!list || at < list.indent)) {
        const gap = m[3] ? width(m[3]) : 1;
        const indent = at + m[2].length + (gap > 4 ? 1 : gap);
        list = { indent: Math.min(list?.indent ?? Infinity, indent), kind: kindOf(m[2]) };
      }
    }
  }
  if (conflict >= 0) return conflict;
  if (cur.length) out.push(cur.join("\n"));
  return out;
}

/** Bullets of one character form one list, numbers with one delimiter another. */
const kindOf = (marker: string) => (/\d/.test(marker) ? marker.slice(-1) : marker);

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

/**
 * `inserted` as blocks of their own, splitting block `index` at `sel` (its end when null; an index
 * past the end appends). `after` is the index of the first block following them.
 */
export function insertBlocks(
  blocks: string[],
  index: number,
  sel: { start: number; end: number } | null,
  inserted: string[],
): { blocks: string[]; after: number } {
  const src = blocks[index] ?? "";
  const cut = sel ?? { start: src.length, end: src.length };
  const before = src.slice(0, cut.start).trimEnd();
  const tail = src.slice(cut.end).replace(/^[ \t]*\n?/, "");
  const head = splitBlocks(joinBlocks([...blocks.slice(0, index), before, ...inserted]));
  return { blocks: splitBlocks(joinBlocks([...head, tail, ...blocks.slice(index + 1)])), after: head.length };
}

/** A span from offset `start` of block `s` to offset `end` of block `e`. */
export interface BlockSpan {
  s: number;
  start: number;
  e: number;
  end: number;
}

/** The markdown a span covers. */
export function sliceBlocks(blocks: string[], r: BlockSpan): string {
  if (r.s === r.e) return blocks[r.s].slice(r.start, r.end);
  return joinBlocks([blocks[r.s].slice(r.start), ...blocks.slice(r.s + 1, r.e), blocks[r.e].slice(0, r.end)]);
}

/** Replace a span with `text`, which joins what's left of its first and last blocks into one. */
export function spliceBlocks(blocks: string[], r: BlockSpan, text: string): string[] {
  const next = [...blocks];
  next.splice(r.s, r.e - r.s + 1, blocks[r.s].slice(0, r.start) + text + blocks[r.e].slice(r.end));
  return next;
}
