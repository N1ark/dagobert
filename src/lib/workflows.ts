import type { Workflow } from "./types";

/** The implicit workflow every note starts with. Not stored on disk. */
export const DEFAULT_WORKFLOW: Workflow = {
  id: "",
  name: "Todo",
  stages: [
    { name: "todo", done: false },
    { name: "done", done: true },
  ],
};

/** Colour for a stage pill based on where it sits in the workflow. */
export function stageColor(wf: Workflow, status: string): string {
  const i = wf.stages.findIndex((s) => s.name === status);
  if (i < 0) return "var(--color-dim)";
  if (wf.stages[i].done) return "var(--green)";
  if (i === 0) return "var(--color-dim)";
  return "var(--yellow)";
}
