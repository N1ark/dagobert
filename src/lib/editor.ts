/** Pure text-editing commands for the markdown textarea. */

export interface Sel {
  text: string;
  start: number;
  end: number;
}

/** Wrap the selection in `before`/`after`, or unwrap it if already wrapped. */
export function toggleWrap(s: Sel, before: string, after = before): Sel {
  const { text, start, end } = s;
  const inner = text.slice(start, end);
  // Already wrapped inside the selection (e.g. user selected "**bold**").
  if (inner.startsWith(before) && inner.endsWith(after) && inner.length >= before.length + after.length) {
    const unwrapped = inner.slice(before.length, inner.length - after.length);
    return { text: text.slice(0, start) + unwrapped + text.slice(end), start, end: start + unwrapped.length };
  }
  // Wrapped just outside the selection (e.g. cursor inside **bold**).
  if (text.slice(start - before.length, start) === before && text.slice(end, end + after.length) === after) {
    return {
      text: text.slice(0, start - before.length) + inner + text.slice(end + after.length),
      start: start - before.length,
      end: end - before.length,
    };
  }
  return { text: text.slice(0, start) + before + inner + after + text.slice(end), start: start + before.length, end: end + before.length };
}

/** Turn the selection into a link; the URL is selected for typing. */
export function link(s: Sel): Sel {
  const { text, start, end } = s;
  const inner = text.slice(start, end);
  if (/^https?:\/\//.test(inner)) {
    const out = `[](${inner})`;
    return { text: text.slice(0, start) + out + text.slice(end), start: start + 1, end: start + 1 };
  }
  const label = inner || "text";
  const out = `[${label}](url)`;
  const urlAt = start + label.length + 3;
  return { text: text.slice(0, start) + out + text.slice(end), start: urlAt, end: urlAt + 3 };
}

/** If `pasted` is a URL and text is selected, wrap the selection as `[selection](url)`. */
export function pasteLink(s: Sel, pasted: string): Sel | null {
  const url = pasted.trim();
  if (s.start === s.end || !/^(https?:\/\/|mailto:)\S+$/.test(url) || url.includes("\n")) return null;
  const { text, start, end } = s;
  const out = `[${text.slice(start, end)}](${url})`;
  return { text: text.slice(0, start) + out + text.slice(end), start: start + out.length, end: start + out.length };
}

const LIST_RE = /^(\s*)([-*+]|\d+\.)(\s+\[[ xX]\])?\s+/;

/** Continue a list on Enter; returns null when not in a list. */
export function continueList(s: Sel): Sel | null {
  const { text, start } = s;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const line = text.slice(lineStart, start);
  const m = LIST_RE.exec(line);
  if (!m) return null;
  // Empty item: pressing Enter ends the list.
  if (line.trim() === m[0].trim()) {
    return { text: text.slice(0, lineStart) + text.slice(start), start: lineStart, end: lineStart };
  }
  let marker = m[2];
  if (/^\d+\.$/.test(marker)) marker = `${parseInt(marker) + 1}.`;
  const box = m[3] ? " [ ]" : "";
  const insert = `\n${m[1]}${marker}${box} `;
  return { text: text.slice(0, start) + insert + text.slice(s.end), start: start + insert.length, end: start + insert.length };
}

/** Indent / outdent every line touched by the selection. */
export function indent(s: Sel, out: boolean): Sel {
  const { text, start, end } = s;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const toNl = text.indexOf("\n", end);
  const to = toNl === -1 ? text.length : toNl;
  const block = text.slice(from, to);
  const lines = block.split("\n");
  let firstDelta = 0;
  const changed = lines.map((l, i) => {
    if (out) {
      const m = /^( {1,2}|\t)/.exec(l);
      const d = m ? m[0].length : 0;
      if (i === 0) firstDelta = -d;
      return l.slice(d);
    }
    if (i === 0) firstDelta = 2;
    return "  " + l;
  });
  const newBlock = changed.join("\n");
  const delta = newBlock.length - block.length;
  return {
    text: text.slice(0, from) + newBlock + text.slice(to),
    start: Math.max(from, start + firstDelta),
    end: Math.max(from, end + delta),
  };
}

/** Map a keydown to a command, or null. */
export function command(e: KeyboardEvent, s: Sel): Sel | null {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Enter" && !mod && !e.shiftKey) return continueList(s);
  if (e.key === "Tab") return indent(s, e.shiftKey);
  if (!mod) return null;
  const k = e.key.toLowerCase();
  if (k === "b") return toggleWrap(s, "**");
  if (k === "i") return toggleWrap(s, "*");
  if (k === "e" || k === "`") return toggleWrap(s, "`");
  if (k === "k") return link(s);
  if (k === "x" && e.shiftKey) return toggleWrap(s, "~~");
  if (k === "h") return toggleWrap(s, "==");
  return null;
}
