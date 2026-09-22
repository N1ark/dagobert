export interface Note {
  id: string;
  title: string;
  tags: string[];
  created: string;
  modified: string;
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

/** Git tracking settings; shared via `dagobert.json` so every machine behaves the same. */
export interface GitSettings {
  enabled: boolean;
  /** Minutes between automatic sync cycles. */
  interval_min: number;
}

export interface GitStatus {
  branch: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  has_remote: boolean;
  has_upstream: boolean;
  /** Unix seconds of the HEAD commit. */
  last_commit_at: number | null;
}

/** A note the last pull had to merge. */
export interface Conflict {
  id: string;
  title: string;
  file: string;
  /** The body still holds `<<<<<<<` markers. */
  body_conflict: boolean;
}

export interface SyncReport {
  committed: boolean;
  pulled: "no-remote" | "up-to-date" | "fast-forward" | "merging" | null;
  pushed: boolean;
  conflicts: Conflict[];
  error: string | null;
  status: GitStatus | null;
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
  git: GitSettings;
}

/** Partial meta update; absent fields keep their stored value. */
export type MetaPatch = Partial<Meta>;

export interface Project {
  path: string;
  notes: Note[];
  meta: Meta;
  local: Local;
}

/** A project in the app's data directory, addressed by name. */
export interface ProjectRef {
  name: string;
  path: string;
}
