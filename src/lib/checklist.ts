/** A checklist note's task items (`- [ ] …`), read from and written back to its body. */

export interface Task {
  /** Line index in the body. */
  line: number;
  text: string;
  done: boolean;
}

/** What a new checklist starts from when the project has no template of its own. */
export const CHECKLIST_TEMPLATE = "- [ ] ";

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s|$)(.*)$/;

export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

/** Task items with some text, in order; those inside fenced code don't count. */
export function tasks(body: string): Task[] {
  const out: Task[] = [];
  let fence: string | null = null;
  body.split("\n").forEach((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return;
    }
    if (f) {
      fence = f[1];
      return;
    }
    const m = TASK_RE.exec(line);
    const text = m?.[3].trim();
    if (m && text) out.push({ line: i, text, done: m[2] !== " " });
  });
  return out;
}

/** Ticked items / items. */
export function taskProgress(body: string): { done: number; total: number } {
  const all = tasks(body);
  return { done: all.filter((t) => t.done).length, total: all.length };
}

/** Ticks or unticks the task item on body line `line`; any other line comes back unchanged. */
export function toggleTask(body: string, line: number): string {
  const lines = body.split("\n");
  const m = TASK_RE.exec(lines[line] ?? "");
  if (!m) return body;
  lines[line] = `${m[1]}[${m[2] === " " ? "x" : " "}]${m[3]}`;
  return lines.join("\n");
}
