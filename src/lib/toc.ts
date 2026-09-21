import { splitBlocks, isCode } from "./blocks.ts";

export type Heading = { level: number; text: string; block: number };

/** ATX headings in `body` (outside fenced code), each with the index of the block holding it. */
export function headings(body: string): Heading[] {
  const out: Heading[] = [];
  splitBlocks(body).forEach((block, i) => {
    if (isCode(block)) return;
    for (const line of block.split("\n")) {
      const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (m && m[2]) out.push({ level: m[1].length, text: m[2], block: i });
    }
  });
  return out;
}
