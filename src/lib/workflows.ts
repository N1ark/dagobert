import { t } from "./i18n";
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

/** Colour for a stage pill based on where it sits in the workflow. */
export function stageColor(wf: Workflow, status: string): string {
  const i = wf.stages.findIndex((s) => s.name === status);
  if (i < 0) return "var(--muted)";
  if (wf.stages[i].color) return wf.stages[i].color!;
  if (wf.stages[i].done) return "var(--success)";
  if (i === 0) return "var(--muted)";
  return "var(--warn)";
}
