export interface Note {
  id: string;
  title: string;
  tags: string[];
  created: string;
  modified: string;
  opened: string;
  /** Workflow id; null means the built-in todo/done workflow. */
  workflow: string | null;
  /** Current stage name within the workflow. */
  status: string;
  /** Tracking issue: done when every dependency is done; has no status of its own. */
  tracking?: boolean;
  x: number;
  y: number;
  /** Card width on the canvas; null/undefined means the default. */
  width?: number | null;
  /** IDs of notes this note depends on. */
  deps: string[];
  /** Set only for notes in the trash. */
  deleted?: string | null;
  body: string;
  /** File name inside `notes/` (or `trash/`), assigned by the backend. */
  file: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Stage {
  name: string;
  /** Whether a note at this stage counts as done. */
  done: boolean;
  /** Optional colour for the status pill; null = automatic. */
  color?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  stages: Stage[];
  /** Default body for new notes on this workflow. */
  template: string;
}

/** Per-machine state in `dagobert.local.json`; never synced between machines. */
export interface Local {
  viewport: Viewport;
}

export interface Meta {
  /** Tag name -> CSS colour. */
  tag_colors: Record<string, string>;
  /** User-defined workflows; the default todo/done one is implicit. */
  workflows: Workflow[];
  /** Default body for new notes on the built-in Todo workflow. */
  default_template: string;
  /** Template for new tracking issues. */
  tracking_template: string;
  /** GitHub repo aliases: alias -> "owner/name". */
  repos: Record<string, string>;
  /** User-added swatches shown in colour pickers after the built-in palette. */
  palette: string[];
}

/** Partial meta update; absent fields keep their stored value. */
export type MetaPatch = Partial<Meta>;

export interface Project {
  path: string;
  notes: Note[];
  meta: Meta;
  local: Local;
}
