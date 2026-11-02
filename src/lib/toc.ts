export type Heading = { level: number; text: string; from: number };

/** ATX headings in `body` (outside fenced code), each with the offset its line starts at. */
export function headings(body: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  let from = 0;
  for (const line of body.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
    } else if (f) {
      fence = f[1];
    } else {
      const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (m && m[2]) out.push({ level: m[1].length, text: m[2], from });
    }
    from += line.length + 1;
  }
  return out;
}
