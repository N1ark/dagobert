import { t } from "./i18n.ts";
import type { Workflow } from "./types";

/** The implicit workflow every note starts with. Not stored on disk. */
export const DEFAULT_WORKFLOW: Workflow = {
  id: "",
  name: t("settings.nav.todo"),
  stages: [
    { name: "todo", done: false },
    { name: "done", done: true },
  ],
  template: "",
};

/** Fill `{{date}}` / `{{title}}` placeholders in a template. */
export function renderTemplate(template: string, title = ""): string {
  return template.replace(/\{\{\s*date\s*\}\}/g, new Date().toISOString().slice(0, 10)).replace(/\{\{\s*title\s*\}\}/g, title);
}

/** Whitespace (zero-width too) never makes a body "written". */
const squash = (s: string) => s.replace(/[\s\u200b-\u200d\u2060]+/g, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `body` is empty or just `template` as filled on any day, with `title` or none, whitespace aside. */
export function untouched(body: string, template: string, title = ""): boolean {
  const b = squash(body);
  if (!b) return true;
  const name = `(?:${escape(squash(title))})?`;
  const re = squash(template)
    .split(/(\{\{(?:date|title)\}\})/)
    .map((part, i) => (i % 2 ? (part === "{{date}}" ? "\\d{4}-\\d{2}-\\d{2}" : name) : escape(part)))
    .join("");
  return new RegExp(`^${re}$`).test(b);
}

/** Colour for a stage pill based on where it sits in the workflow. */
export function stageColor(wf: Workflow, status: string): string {
  const i = wf.stages.findIndex((s) => s.name === status);
  if (i < 0) return "var(--muted)";
  if (wf.stages[i].color) return wf.stages[i].color!;
  if (wf.stages[i].done) return "var(--success)";
  if (i === 0) return "var(--muted)";
  return "var(--warn)";
}
