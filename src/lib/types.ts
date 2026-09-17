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
}

export interface Workflow {
  id: string;
  name: string;
  stages: Stage[];
  /** Default body for new notes on this workflow. */
  template: string;
}

export interface Meta {
  viewport: Viewport;
  /** Tag name -> CSS colour. */
  tag_colors: Record<string, string>;
  /** User-defined workflows; the default todo/done one is implicit. */
  workflows: Workflow[];
  /** Default body for new notes on the built-in Todo workflow. */
  default_template: string;
}

/** Partial meta update; absent fields keep their stored value. */
export type MetaPatch = Partial<Meta>;

export interface Project {
  path: string;
  notes: Note[];
  meta: Meta;
}
