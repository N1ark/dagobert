/** Fuzzy matching for the quick-open palette. */

export interface Match {
  /** Higher is better; 0 means no match. */
  score: number;
  /** Indices of matched characters in the haystack (for highlighting). */
  indices: number[];
}

const NO_MATCH: Match = { score: 0, indices: [] };

/** Case-insensitive subsequence match, ranked prefix > word start > substring > subsequence. */
export function fuzzyMatch(query: string, text: string): Match {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return { score: 1, indices: [] };
  if (!t) return NO_MATCH;

  if (t.startsWith(q)) return { score: 1000 - t.length * 0.01, indices: range(0, q.length) };

  const wordAt = wordStarts(t);
  // Word-start prefix: "sch" matches "Design the Schema".
  for (const start of wordAt) {
    if (t.startsWith(q, start)) return { score: 800 - start * 0.1, indices: range(start, start + q.length) };
  }

  const sub = t.indexOf(q);
  if (sub >= 0) return { score: 600 - sub * 0.1, indices: range(sub, sub + q.length) };

  // Greedy subsequence, preferring word starts for each character.
  const starts = new Set(wordAt);
  const indices: number[] = [];
  let pos = 0;
  let score = 300;
  for (const ch of q) {
    let found = -1;
    // Prefer the next occurrence that sits on a word start.
    for (let i = pos; i < t.length; i++) {
      if (t[i] === ch && starts.has(i)) {
        found = i;
        break;
      }
    }
    if (found < 0) found = t.indexOf(ch, pos);
    if (found < 0) return NO_MATCH;
    if (indices.length) score -= (found - indices[indices.length - 1] - 1) * 2; // gap penalty
    if (starts.has(found)) score += 10;
    indices.push(found);
    pos = found + 1;
  }
  return { score: Math.max(1, score), indices };
}

function wordStarts(t: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (/[a-z0-9]/i.test(t[i]) && (i === 0 || !/[a-z0-9]/i.test(t[i - 1]))) out.push(i);
  }
  return out;
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

/** Parse the palette query into its mode and the text to match. */
export function parseQuery(raw: string): { text: string; tag: string | null } {
  const s = raw.trimStart();
  const m = /^#(\S*)\s*(.*)$/.exec(s);
  if (m) return { text: m[2].trim(), tag: m[1].toLowerCase() };
  return { text: s.trim(), tag: null };
}
