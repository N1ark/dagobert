import { backend, type ProjectChange, type SyncMessage } from "./backend";
import type { MetaPatch, Note, Viewport, Workflow } from "./types";
import { History, type NoteDiff } from "./history";
import { DEFAULT_WORKFLOW, renderTemplate } from "./workflows";
import { DEFAULT_TAG_COLOR, normalizeColor, TAG_PALETTE } from "./tags";

const RECENT_KEY = "dagobert.recent";
const LAST_KEY = "dagobert.last";
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function now() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

class Store {
  path = $state<string | null>(null);
  notes = $state<Note[]>([]);
  viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
  tagColors = $state<Record<string, string>>({});
  workflows = $state<Workflow[]>([]);
  /** GitHub repo aliases: alias -> "owner/name". */
  repos = $state<Record<string, string>>({});
  /** User-added swatches (project-wide), shown after the built-in palette. */
  palette = $state<string[]>([]);
  /** Template for new notes on the built-in Todo workflow. */
  defaultTemplate = $state("");
  trackingTemplate = $state("");
  /** Tags currently used to filter the canvas (OR semantics). */
  tagFilter = $state<string[]>([]);
  selectedId = $state<string | null>(null);
  /** Multi-selection on the canvas (may include `selectedId`). */
  multi = $state<string[]>([]);
  /** Bumped to ask the panel to focus the title field (keyboard Enter). */
  focusTitle = $state(0);
  recent = $state<string[]>(loadRecent());
  error = $state<string | null>(null);

  /** Installed by App: select a note and centre the canvas on it. */
  jump: (id: string) => void = (id) => this.select(id);

  selected = $derived(this.selectedId ? this.byId(this.selectedId) : null);
  /** Every tag in the project with its usage count, most used first. */
  allTags = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const n of this.notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  });
  projectName = $derived(this.path?.split(/[\\/]/).filter(Boolean).pop() ?? "");

  #saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---- undo/redo state -----------------------------------------------------
  #history = new History();
  /** Last recorded snapshot per note: the "before" of the next diff. */
  #last = new Map<string, Note>();
  /** Diffs collected during the current synchronous handler, flushed as one entry. */
  #pending: { label: string; diffs: NoteDiff[] } | null = null;
  /** True while undo/redo is applying; suppresses recording. */
  #applying = false;
  undoDepth = $state(0);
  redoDepth = $state(0);
  /** Neutral toast (e.g. "Undid: move"). */
  notice = $state<string | null>(null);
  /** Writes currently in flight, so a delete can wait for them. */
  #inflight = new Map<string, Promise<void>>();
  /** IDs removed this session; late writes for them are dropped. */
  #deleted = new Set<string>();
  #metaTimer: ReturnType<typeof setTimeout> | null = null;

  byId(id: string): Note | null {
    return this.notes.find((n) => n.id === id) ?? null;
  }

  dependents(id: string): Note[] {
    return this.notes.filter((n) => n.deps.includes(id));
  }

  dependencies(id: string): Note[] {
    const n = this.byId(id);
    return n ? n.deps.map((d) => this.byId(d)).filter((x): x is Note => !!x) : [];
  }

  tagColor(tag: string): string {
    return this.tagColors[tag] ?? DEFAULT_TAG_COLOR;
  }

  setTagColor(tag: string, color: string | null) {
    if (color && color !== DEFAULT_TAG_COLOR) this.tagColors[tag] = color;
    else delete this.tagColors[tag];
    this.saveMeta();
  }

  /** Add a swatch to the project palette; returns the normalised colour (or null if invalid). */
  addPaletteColor(color: string): string | null {
    const c = normalizeColor(color);
    if (!c) return null;
    if (!TAG_PALETTE.includes(c) && !this.palette.includes(c)) {
      this.palette = [...this.palette, c];
      this.saveMeta();
    }
    return c;
  }

  removePaletteColor(color: string) {
    if (!this.palette.includes(color)) return;
    this.palette = this.palette.filter((c) => c !== color);
    this.saveMeta();
  }

  setRepo(alias: string, repo: string | null) {
    const a = alias.trim();
    if (!a) return;
    if (repo && repo.trim()) this.repos[a] = repo.trim();
    else delete this.repos[a];
    this.saveMeta();
  }

  toggleTagFilter(tag: string) {
    this.tagFilter = this.tagFilter.includes(tag) ? this.tagFilter.filter((t) => t !== tag) : [...this.tagFilter, tag];
  }

  // ---- workflows -----------------------------------------------------------

  workflowOf(note: Note): Workflow {
    return (note.workflow && this.workflows.find((w) => w.id === note.workflow)) || DEFAULT_WORKFLOW;
  }

  isDone(note: Note): boolean {
    if (note.tracking) {
      const p = this.progress(note);
      return p.total > 0 && p.done === p.total;
    }
    return this.workflowOf(note).stages.find((s) => s.name === note.status)?.done ?? false;
  }

  /** Direct dependencies done / total (what a tracking issue's ring shows). */
  progress(note: Note): { done: number; total: number } {
    let done = 0,
      total = 0;
    for (const d of note.deps) {
      const dep = this.byId(d);
      if (!dep) continue;
      total++;
      if (this.isDone(dep)) done++;
    }
    return { done, total };
  }

  setTracking(id: string, tracking: boolean) {
    const n = this.byId(id);
    if (!n || !!n.tracking === tracking) return;
    const blank = this.#bodyIsBlank(n);
    n.tracking = tracking;
    if (tracking) n.workflow = null;
    if (blank) n.body = renderTemplate(this.templateFor(n.workflow, tracking), n.title);
    this.touch(id, { immediate: true, label: "kind" });
  }

  /** Mark done (first done stage) or not done (first stage) in the note's own workflow. */
  setDone(id: string, done: boolean) {
    const n = this.byId(id);
    if (!n || n.tracking) return;
    const stages = this.workflowOf(n).stages;
    const target = done ? (stages.find((s) => s.done) ?? stages[stages.length - 1]) : stages[0];
    this.setStatus(id, target.name);
  }

  setStatus(id: string, status: string) {
    const n = this.byId(id);
    if (!n || n.status === status) return;
    n.status = status;
    this.touch(id, { immediate: true, label: "status" });
  }

  /** Move to the next stage, wrapping around at the end. */
  /** Move to the next stage (or previous with `step = -1`), wrapping around. */
  advance(id: string, step = 1) {
    const n = this.byId(id);
    if (!n || n.tracking) return;
    const stages = this.workflowOf(n).stages;
    const i = stages.findIndex((s) => s.name === n.status);
    this.setStatus(id, stages[(i + step + stages.length) % stages.length].name);
  }

  /** Switch a note to another workflow, keeping done-ness where possible. */
  /** Raw template for a workflow id (null = built-in Todo) or a tracking issue. */
  templateFor(workflowId: string | null, tracking = false): string {
    if (tracking) return this.trackingTemplate;
    return workflowId ? (this.workflows.find((w) => w.id === workflowId)?.template ?? "") : this.defaultTemplate;
  }

  /** True when the body is empty or is just an untouched template. */
  #bodyIsBlank(n: Note): boolean {
    const b = n.body.trim();
    if (!b) return true;
    const tpl = this.templateFor(n.workflow, !!n.tracking);
    return b === tpl.trim() || b === renderTemplate(tpl, n.title).trim();
  }

  setWorkflow(id: string, workflowId: string | null) {
    const n = this.byId(id);
    if (!n) return;
    const wasDone = this.isDone(n);
    const blank = this.#bodyIsBlank(n);
    n.workflow = workflowId;
    const stages = this.workflowOf(n).stages;
    n.status = (wasDone ? (stages.find((s) => s.done) ?? stages[0]) : stages[0]).name;
    // An untouched body picks up the new workflow's template.
    if (blank) n.body = renderTemplate(this.templateFor(workflowId), n.title);
    this.touch(id, { immediate: true, label: "workflow" });
  }

  addWorkflow(): Workflow {
    const wf: Workflow = {
      id: newId(),
      name: "New workflow",
      stages: [
        { name: "todo", done: false },
        { name: "in progress", done: false },
        { name: "done", done: true },
      ],
      template: "",
    };
    this.workflows.push(wf);
    this.saveMeta();
    return wf;
  }

  /** Persist edits to a workflow and repair notes whose stage no longer exists. */
  updateWorkflow(wf: Workflow) {
    for (const n of this.notes) {
      if (n.workflow === wf.id && !wf.stages.some((s) => s.name === n.status)) {
        n.status = wf.stages[0]?.name ?? "todo";
        this.touch(n.id, { immediate: true, silent: true });
      }
    }
    this.saveMeta();
  }

  removeWorkflow(id: string) {
    this.workflows = this.workflows.filter((w) => w.id !== id);
    for (const n of this.notes) if (n.workflow === id) this.setWorkflow(n.id, null);
    this.saveMeta();
  }

  /** True when every dependency of the note is done. */
  isReady(note: Note): boolean {
    if (note.tracking || this.isDone(note)) return false;
    return note.deps.every((d) => {
      const dep = this.byId(d);
      return dep ? this.isDone(dep) : true;
    });
  }

  /** Would making `dependent` depend on `dep` create a cycle? */
  wouldCycle(dependent: string, dep: string): boolean {
    if (dependent === dep) return true;
    const stack = [dep];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === dependent) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const n = this.byId(cur);
      if (n) stack.push(...n.deps);
    }
    return false;
  }

  // ---- project lifecycle ---------------------------------------------------

  async pickAndOpen() {
    const dir = await backend.pickFolder();
    if (dir) await this.open(dir);
  }

  async open(path: string) {
    try {
      const p = await backend.openProject(path);
      this.path = p.path;
      this.notes = p.notes;
      // Guard against a malformed dagobert.json: a zero/NaN zoom poisons every coordinate.
      const v = p.meta.viewport;
      this.tagColors = p.meta.tag_colors ?? {};
      this.workflows = p.meta.workflows ?? [];
      this.defaultTemplate = p.meta.default_template ?? "";
      this.trackingTemplate = p.meta.tracking_template ?? "";
      this.repos = p.meta.repos ?? {};
      this.palette = p.meta.palette ?? [];
      this.tagFilter = [];
      this.#history.clear();
      this.#last = new Map(p.notes.map((n) => [n.id, structuredClone(n)]));
      this.#syncDepths();
      this.viewport = {
        x: Number.isFinite(v.x) ? v.x : 0,
        y: Number.isFinite(v.y) ? v.y : 0,
        zoom: Number.isFinite(v.zoom) && v.zoom > 0 ? v.zoom : 1,
      };
      this.selectedId = null;
      this.#deleted.clear();
      this.trash = [];
      this.recent = [p.path, ...this.recent.filter((r) => r !== p.path)].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
      localStorage.setItem(LAST_KEY, p.path);
      this.error = null;
      backend.watchProject(p.path).catch((e) => this.fail(e));
    } catch (e) {
      this.fail(e);
    }
  }

  /** Reopen whatever was open last time (called once at startup). */
  async restore() {
    const last = localStorage.getItem(LAST_KEY);
    if (last) await this.open(last);
  }

  close() {
    this.flushAll();
    void backend.unwatchProject();
    localStorage.removeItem(LAST_KEY);
    this.path = null;
    this.notes = [];
    this.selectedId = null;
  }

  forgetRecent(path: string) {
    this.recent = this.recent.filter((r) => r !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
  }

  fail(e: unknown) {
    this.error = typeof e === "string" ? e : ((e as Error)?.message ?? String(e));
    console.error(e);
    setTimeout(() => (this.error = null), 4000);
  }

  // ---- notes ---------------------------------------------------------------

  create(x: number, y: number, init: Partial<Note> = {}): Note {
    const t = now();
    const note: Note = {
      id: newId(),
      title: "",
      tags: [],
      created: t,
      modified: t,
      opened: t,
      workflow: null,
      status: DEFAULT_WORKFLOW.stages[0].name,
      x,
      y,
      width: null,
      deps: [],
      body: "",
      file: "",
      ...init,
    };
    // New notes start from their workflow's template; clones/pastes pass a body.
    if (init.body === undefined) note.body = renderTemplate(this.templateFor(note.workflow, !!note.tracking), note.title);
    this.notes.push(note);
    this.#record("create", { id: note.id, before: null, after: $state.snapshot(note) });
    this.save(note.id, true);
    return note;
  }

  /** A note with nothing in it — typically an accidental double-click. */
  isEmpty(n: Note): boolean {
    return !n.title.trim() && this.#bodyIsBlank(n) && !n.tags.length && !n.deps.length && !this.dependents(n.id).length;
  }

  select(id: string | null) {
    this.multi = id ? [id] : [];
    if (id === this.selectedId) return;
    // Leaving an empty note discards it outright (no trash entry).
    const prev = this.selectedId ? this.byId(this.selectedId) : null;
    if (prev && prev.id !== id && this.isEmpty(prev)) void this.discard(prev.id);
    this.selectedId = id;
    if (id) {
      const n = this.byId(id);
      if (n) {
        n.opened = now();
        this.save(id, true);
      }
    }
  }

  /** Mark a note as edited and schedule a save. */
  touch(id: string, opts: { immediate?: boolean; silent?: boolean; label?: string } = {}) {
    const n = this.byId(id);
    if (!n) return;
    if (!opts.silent) n.modified = now();
    const after = $state.snapshot(n);
    this.#record(opts.label ?? "edit", { id, before: this.#last.get(id) ?? null, after });
    // Other windows see the edit now, not after the debounced save.
    backend.broadcast({ type: "note", note: after });
    this.save(id, opts.immediate);
  }

  async remove(id: string): Promise<string | undefined> {
    const n = this.byId(id);
    if (!n || !this.path) return;
    const path = this.path;
    const t = this.#saveTimers.get(id);
    if (t) clearTimeout(t);
    this.#saveTimers.delete(id);
    this.#deleted.add(id);
    if (this.selectedId === id) this.selectedId = null;
    this.multi = this.multi.filter((x) => x !== id);
    this.notes = this.notes.filter((x) => x.id !== id);
    const diff: NoteDiff = { id, before: this.#last.get(id) ?? $state.snapshot(n), after: null };
    this.#record("delete", diff);
    for (const other of this.notes) {
      if (other.deps.includes(id)) {
        other.deps = other.deps.filter((d) => d !== id);
        this.touch(other.id, { immediate: true, silent: true, label: "delete" });
      }
    }
    // A write may still be creating/renaming the file; let it finish so we
    // know the real filename before moving it to the trash.
    await this.#inflight.get(id);
    try {
      if (n.file) {
        const trashed = await backend.deleteNote(path, n.file, now());
        diff.trashFile = trashed?.file;
      }
      backend.broadcast({ type: "note-removed", id });
      return diff.trashFile;
    } catch (e) {
      this.fail(e);
    }
  }

  /** Hard-delete a note, skipping the trash. */
  async discard(id: string) {
    const n = this.byId(id);
    if (!n || !this.path) return;
    const path = this.path;
    const t = this.#saveTimers.get(id);
    if (t) clearTimeout(t);
    this.#saveTimers.delete(id);
    this.#deleted.add(id);
    if (this.selectedId === id) this.selectedId = null;
    this.multi = this.multi.filter((x) => x !== id);
    this.notes = this.notes.filter((x) => x.id !== id);
    this.#last.delete(id);
    await this.#inflight.get(id);
    try {
      if (n.file) await backend.discardNote(path, n.file);
      backend.broadcast({ type: "note-removed", id });
    } catch (e) {
      this.fail(e);
    }
  }

  // ---- trash ---------------------------------------------------------------

  trash = $state<Note[]>([]);

  async loadTrash() {
    if (!this.path) return;
    try {
      this.trash = await backend.listTrash(this.path);
    } catch (e) {
      this.fail(e);
    }
  }

  async restoreNote(file: string) {
    if (!this.path) return;
    try {
      const n = await backend.restoreNote(this.path, file);
      this.#deleted.delete(n.id);
      // Deps pointing at notes that are still deleted are dropped.
      n.deps = n.deps.filter((d) => this.byId(d));
      n.deleted = null;
      this.notes.push(n);
      this.trash = this.trash.filter((t) => t.file !== file);
      this.#record("restore", { id: n.id, before: null, after: structuredClone(n) });
      backend.broadcast({ type: "note", note: $state.snapshot(n) });
      this.select(n.id);
    } catch (e) {
      this.fail(e);
    }
  }

  async purge(file: string | null) {
    if (!this.path) return;
    try {
      await backend.purgeTrash(this.path, file);
      this.trash = file ? this.trash.filter((t) => t.file !== file) : [];
    } catch (e) {
      this.fail(e);
    }
  }

  // ---- clipboard -----------------------------------------------------------

  /** Internal clipboard: a snapshot of the last copied note. */
  clipboard = $state<Note | null>(null);

  copy(id: string) {
    const n = this.byId(id);
    if (!n) return;
    this.clipboard = $state.snapshot(n);
    // Also hand a plain-text version to the system clipboard.
    const text = `# ${n.title || "Untitled"}\n${n.tags.length ? n.tags.map((t) => "#" + t).join(" ") + "\n" : ""}\n${n.body}`;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  setWidth(id: string, width: number | null) {
    const n = this.byId(id);
    if (!n) return;
    n.width = width;
    this.touch(id, { immediate: true, silent: true, label: "resize" });
  }

  /** Create a fresh note with `src`'s content (no deps, new id) at x/y. */
  cloneAt(src: Note, x: number, y: number): Note {
    const workflow = src.workflow && this.workflows.some((w) => w.id === src.workflow) ? src.workflow : null;
    const stages = (this.workflows.find((w) => w.id === workflow) ?? DEFAULT_WORKFLOW).stages;
    const status = stages.some((s) => s.name === src.status) ? src.status : stages[0].name;
    return this.create(Math.round(x), Math.round(y), {
      title: src.title,
      tags: [...src.tags],
      body: src.body,
      workflow,
      status,
      tracking: !!src.tracking,
      width: src.width ?? null,
    });
  }

  paste(x: number, y: number): Note | null {
    return this.clipboard ? this.cloneAt(this.clipboard, x, y) : null;
  }

  duplicate(id: string): Note | null {
    const n = this.byId(id);
    return n ? this.cloneAt($state.snapshot(n), n.x + 30, n.y + 30) : null;
  }

  addTag(id: string, tag: string) {
    const n = this.byId(id);
    const t = tag.trim().replace(/^#/, "");
    if (!n || !t || n.tags.includes(t)) return;
    n.tags.push(t);
    this.touch(id, { immediate: true, label: "tag" });
  }

  removeTag(id: string, tag: string) {
    const n = this.byId(id);
    if (!n || !n.tags.includes(tag)) return;
    n.tags = n.tags.filter((x) => x !== tag);
    this.touch(id, { immediate: true, label: "untag" });
  }

  toggleTag(id: string, tag: string) {
    const n = this.byId(id);
    if (!n) return;
    if (n.tags.includes(tag)) this.removeTag(id, tag);
    else this.addTag(id, tag);
  }

  /** Make `dependent` depend on `dep`. Returns false on cycle. */
  addDependency(dependent: string, dep: string): boolean {
    const n = this.byId(dependent);
    if (!n || !this.byId(dep)) return false;
    if (n.deps.includes(dep)) return true;
    if (this.wouldCycle(dependent, dep)) {
      this.fail("That would create a cycle.");
      return false;
    }
    n.deps.push(dep);
    this.touch(dependent, { immediate: true, silent: true, label: "link" });
    return true;
  }

  removeDependency(dependent: string, dep: string) {
    const n = this.byId(dependent);
    if (!n) return;
    n.deps = n.deps.filter((d) => d !== dep);
    this.touch(dependent, { immediate: true, silent: true, label: "unlink" });
  }

  // ---- other windows -------------------------------------------------------

  /** Apply a change made in another window. */
  applySync(msg: SyncMessage) {
    if (msg.type === "note") {
      if (this.#deleted.has(msg.note.id)) return;
      const local = this.byId(msg.note.id);
      // Edits are broadcast as they happen, so the latest message is the truth.
      if (local) Object.assign(local, msg.note);
      else this.notes.push(msg.note);
      this.#last.set(msg.note.id, structuredClone(msg.note));
    } else if (msg.type === "note-file") {
      const local = this.byId(msg.id);
      if (local) local.file = msg.file;
    } else if (msg.type === "note-removed") {
      if (!this.byId(msg.id)) return;
      this.#saveTimers.delete(msg.id);
      this.#deleted.add(msg.id);
      if (this.selectedId === msg.id) this.selectedId = null;
      this.multi = this.multi.filter((x) => x !== msg.id);
      this.notes = this.notes.filter((n) => n.id !== msg.id);
      for (const n of this.notes) if (n.deps.includes(msg.id)) n.deps = n.deps.filter((d) => d !== msg.id);
    } else if (msg.type === "meta") {
      if (msg.meta.tag_colors) this.tagColors = msg.meta.tag_colors;
      if (msg.meta.workflows) this.workflows = msg.meta.workflows;
      if (msg.meta.default_template !== undefined) this.defaultTemplate = msg.meta.default_template;
      if (msg.meta.tracking_template !== undefined) this.trackingTemplate = msg.meta.tracking_template;
      if (msg.meta.repos) this.repos = msg.meta.repos;
      if (msg.meta.palette) this.palette = msg.meta.palette;
    }
  }

  /** Apply a change made on disk outside the app (from the file watcher). */
  async applyExternal(change: ProjectChange) {
    if (change.kind === "note") {
      const incoming = change.note;
      if (this.#deleted.has(incoming.id)) return;
      const local = this.byId(incoming.id);
      // Our own pending save wins over the disk version.
      if (local && this.#saveTimers.has(local.id)) return;
      // Match by id, so an external rename updates `file` rather than duplicating.
      if (local) Object.assign(local, incoming);
      else this.notes.push(incoming);
      this.#last.set(incoming.id, structuredClone(incoming));
      this.#dropDanglingDeps();
    } else if (change.kind === "note-removed") {
      const local = this.notes.find((n) => n.file === change.file);
      if (!local) return;
      // The file is already gone; just forget it (no trash, no #deleted).
      const t = this.#saveTimers.get(local.id);
      if (t) clearTimeout(t);
      this.#saveTimers.delete(local.id);
      if (this.selectedId === local.id) this.selectedId = null;
      this.multi = this.multi.filter((x) => x !== local.id);
      this.notes = this.notes.filter((n) => n.id !== local.id);
      this.#dropDanglingDeps();
    } else if (change.kind === "meta") {
      if (!this.path) return;
      try {
        const meta = await backend.readMeta(this.path);
        this.tagColors = meta.tag_colors ?? {};
        this.workflows = meta.workflows ?? [];
        this.defaultTemplate = meta.default_template ?? "";
        this.trackingTemplate = meta.tracking_template ?? "";
        this.repos = meta.repos ?? {};
        this.palette = meta.palette ?? [];
      } catch (e) {
        this.fail(e);
      }
    }
  }

  #dropDanglingDeps() {
    for (const n of this.notes) {
      if (n.deps.some((d) => !this.byId(d))) n.deps = n.deps.filter((d) => this.byId(d));
    }
  }

  revealInFinder(id: string) {
    const n = this.byId(id);
    if (!n || !this.path || !n.file) return;
    backend.revealNote(this.path, n.file).catch((e) => this.fail(e));
  }

  openInWindow(id: string) {
    const n = this.byId(id);
    if (n && this.path) backend.openNoteWindow(this.path, id, n.title);
  }

  // ---- undo / redo ---------------------------------------------------------

  /** Queue a diff; everything recorded in the same tick becomes one entry. */
  #record(label: string, diff: NoteDiff) {
    if (this.#applying) return;
    if (!this.#pending) {
      this.#pending = { label, diffs: [] };
      queueMicrotask(() => this.#flushRecord());
    }
    const existing = this.#pending.diffs.find((d) => d.id === diff.id);
    if (existing)
      existing.after = diff.after; // keep the earliest "before"
    else this.#pending.diffs.push(diff);
    if (diff.after) this.#last.set(diff.id, structuredClone(diff.after));
    else this.#last.delete(diff.id);
  }

  #flushRecord() {
    const p = this.#pending;
    this.#pending = null;
    if (!p) return;
    const label = p.diffs.length > 1 ? `${p.label} (${p.diffs.length} notes)` : p.label;
    this.#history.push({ label, diffs: p.diffs, at: Date.now() });
    this.#syncDepths();
  }

  #syncDepths() {
    this.undoDepth = this.#history.undo.length;
    this.redoDepth = this.#history.redo.length;
  }

  #lastUndoAt = 0;

  async undo() {
    // A menu accelerator and the keydown handler can both fire for one ⌘Z.
    if (Date.now() - this.#lastUndoAt < 150) return;
    this.#lastUndoAt = Date.now();
    this.#flushRecord();
    const e = this.#history.popUndo();
    if (!e) return;
    await this.#apply(e.diffs, "undo");
    this.#syncDepths();
    this.#toast(`Undid: ${e.label}`);
  }

  async redo() {
    if (Date.now() - this.#lastUndoAt < 150) return;
    this.#lastUndoAt = Date.now();
    const e = this.#history.popRedo();
    if (!e) return;
    await this.#apply(e.diffs, "redo");
    this.#syncDepths();
    this.#toast(`Redid: ${e.label}`);
  }

  /** Put every note in `diffs` into its `before` (undo) or `after` (redo) state. */
  async #apply(diffs: NoteDiff[], dir: "undo" | "redo") {
    if (!this.path) return;
    this.#applying = true;
    try {
      // Bring notes back first so restored links have something to point at.
      const ordered = [...diffs].sort(
        (a, b) => Number(!(dir === "undo" ? a.before : a.after)) - Number(!(dir === "undo" ? b.before : b.after)),
      );
      for (const d of ordered) {
        const target = dir === "undo" ? d.before : d.after;
        const local = this.byId(d.id);
        if (!target) {
          if (local) d.trashFile = await this.remove(d.id);
          continue;
        }
        if (local) {
          const { file: _f, ...fields } = target;
          Object.assign(local, fields);
          this.save(d.id, true);
        } else {
          let n: Note | null = null;
          if (d.trashFile) {
            try {
              n = await backend.restoreNote(this.path, d.trashFile);
            } catch {
              n = null; // trash was emptied; fall through and recreate
            }
          }
          this.#deleted.delete(d.id);
          const fresh: Note = { ...target, file: n?.file ?? "", deleted: null };
          this.notes.push(fresh);
          this.save(d.id, true);
        }
        this.#last.set(d.id, structuredClone(target));
      }
      this.#dropDanglingDeps();
    } finally {
      this.#applying = false;
    }
  }

  #toast(msg: string) {
    this.notice = msg;
    setTimeout(() => {
      if (this.notice === msg) this.notice = null;
    }, 2000);
  }

  // ---- persistence ---------------------------------------------------------

  save(id: string, immediate = false) {
    const prev = this.#saveTimers.get(id);
    if (prev) clearTimeout(prev);
    if (immediate) {
      this.#saveTimers.delete(id);
      void this.#write(id);
    } else {
      this.#saveTimers.set(
        id,
        setTimeout(() => {
          this.#saveTimers.delete(id);
          void this.#write(id);
        }, 500),
      );
    }
  }

  async #write(id: string) {
    const n = this.byId(id);
    if (!n || !this.path || this.#deleted.has(id)) return;
    // Serialise writes per note so a rename can't race an earlier save.
    const prev = this.#inflight.get(id) ?? Promise.resolve();
    const job = prev.then(async () => {
      if (this.#deleted.has(id)) return;
      try {
        const saved = await backend.saveNote(this.path!, $state.snapshot(n));
        if (saved.file !== n.file) {
          n.file = saved.file;
          backend.broadcast({ type: "note-file", id, file: saved.file });
        }
      } catch (e) {
        this.fail(e);
      }
    });
    this.#inflight.set(id, job);
    await job;
    if (this.#inflight.get(id) === job) this.#inflight.delete(id);
  }

  #metaDirty = { viewport: false, settings: false };

  /** What's changed since the last meta write; only those fields are sent. */
  #metaPatch() {
    const patch: MetaPatch = {};
    if (this.#metaDirty.viewport) patch.viewport = $state.snapshot(this.viewport);
    if (this.#metaDirty.settings) {
      patch.tag_colors = $state.snapshot(this.tagColors);
      patch.workflows = $state.snapshot(this.workflows);
      patch.default_template = this.defaultTemplate;
      patch.tracking_template = this.trackingTemplate;
      patch.repos = $state.snapshot(this.repos);
      patch.palette = $state.snapshot(this.palette);
    }
    this.#metaDirty = { viewport: false, settings: false };
    return patch;
  }

  #scheduleMeta() {
    if (this.#metaTimer) clearTimeout(this.#metaTimer);
    this.#metaTimer = setTimeout(() => {
      this.#metaTimer = null;
      this.#flushMeta();
    }, 400);
  }

  #flushMeta() {
    if (!this.path) return;
    const patch = this.#metaPatch();
    if (!Object.keys(patch).length) return;
    backend.saveMeta(this.path, patch).catch((e) => this.fail(e));
    if (patch.tag_colors || patch.workflows)
      backend.broadcast({
        type: "meta",
        meta: {
          tag_colors: patch.tag_colors,
          workflows: patch.workflows,
          default_template: patch.default_template,
          tracking_template: patch.tracking_template,
          repos: patch.repos,
          palette: patch.palette,
        },
      });
  }

  /** Tag colours / workflows changed. */
  saveMeta() {
    this.#metaDirty.settings = true;
    this.#scheduleMeta();
  }

  saveViewport() {
    this.#metaDirty.viewport = true;
    this.#scheduleMeta();
  }

  flushAll() {
    for (const [id, t] of this.#saveTimers) {
      clearTimeout(t);
      void this.#write(id);
    }
    this.#saveTimers.clear();
    if (this.#metaTimer) {
      clearTimeout(this.#metaTimer);
      this.#metaTimer = null;
      this.#flushMeta();
    }
  }
}

export const store = new Store();
