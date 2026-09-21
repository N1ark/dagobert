/** Split markdown into editable blocks and back. */

const CONFLICT_START = /^<{7} /;
const CONFLICT_MID = /^={7}$/;
const CONFLICT_END = /^>{7} /;
/** Any git conflict marker line. */
export const MARKER_RE = /^(<{7} |={7}$|>{7} )/;

/**
 * Blocks are separated by blank lines, except inside fenced code and git
 * conflict regions (`<<<<<<<` … `>>>>>>>`), where blank lines are kept.
 * Runs of blank lines collapse to one on re-join.
 */
export function splitBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let conflict = false;
  for (const line of text.split("\n")) {
    if (conflict) {
      cur.push(line);
      if (CONFLICT_END.test(line)) {
        conflict = false;
        out.push(cur.join("\n"));
        cur = [];
      }
      continue;
    }
    if (!fence && CONFLICT_START.test(line)) {
      if (cur.length) out.push(cur.join("\n"));
      cur = [line];
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

/** True when the block is a git conflict region. */
export function isConflict(block: string): boolean {
  return CONFLICT_START.test(block) && CONFLICT_END.test(block.slice(block.lastIndexOf("\n") + 1));
}

/** The two sides of a conflict block, without the marker lines. */
export function conflictSides(block: string): { mine: string; theirs: string } {
  const lines = block.split("\n");
  const mid = lines.findIndex((l) => CONFLICT_MID.test(l));
  const end = lines.length - 1;
  if (mid < 0) return { mine: lines.slice(1, end).join("\n"), theirs: "" };
  return { mine: lines.slice(1, mid).join("\n"), theirs: lines.slice(mid + 1, end).join("\n") };
}

/** Replace a conflict block by one side, or both in order. */
export function resolveConflict(block: string, keep: "mine" | "theirs" | "both"): string {
  const { mine, theirs } = conflictSides(block);
  if (keep === "mine") return mine;
  if (keep === "theirs") return theirs;
  return [mine, theirs].filter((s) => s.trim()).join("\n");
}

/** The body without git conflict marker lines (for search, links, previews). */
export function stripMarkers(text: string): string {
  return text
    .split("\n")
    .filter((l) => !MARKER_RE.test(l))
    .join("\n");
}
