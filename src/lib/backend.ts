/**
 * Thin wrapper over the Tauri commands. When the page is opened in a plain
 * browser (e.g. `npm run dev` for UI work) it falls back to an in-memory
 * project so the UI stays usable without the Rust side.
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Meta, MetaPatch, Note, Project } from "./types";

export const inTauri = "__TAURI_INTERNALS__" in window;

/** A change on disk reported by the Rust file watcher. */
export type ProjectChange = { kind: "note"; note: Note } | { kind: "note-removed"; file: string } | { kind: "meta" };

/** Cross-window sync messages. */
export type SyncMessage = { type: "note"; note: Note } | { type: "note-removed"; id: string } | { type: "meta"; meta: MetaPatch };

const channel = inTauri ? null : new BroadcastChannel("dagobert");

const mock: { notes: Map<string, Note>; trash: Note[]; meta: Meta } = {
  notes: new Map(),
  trash: [],
  meta: {
    viewport: { x: 0, y: 0, zoom: 1 },
    tag_colors: {},
    workflows: [],
    default_template: "",
    tracking_template: "",
    repos: {},
    palette: [],
  },
};

export const backend = {
  async pickFolder(): Promise<string | null> {
    if (!inTauri) return "/browser-mock";
    const dir = await openDialog({ directory: true, multiple: false, title: "Open a Dagobert folder" });
    return typeof dir === "string" ? dir : null;
  },

  async openProject(path: string): Promise<Project> {
    if (!inTauri) return { path, notes: [...mock.notes.values()], meta: mock.meta };
    return invoke<Project>("open_project", { path });
  },

  async saveNote(path: string, note: Note): Promise<Note> {
    if (!inTauri) {
      const saved = { ...note, file: note.file || `${note.id}.md` };
      mock.notes.set(note.id, saved);
      return saved;
    }
    return invoke<Note>("save_note", { path, note });
  },

  /** Soft delete: moves the file into `trash/`. */
  async deleteNote(path: string, file: string, deletedAt: string): Promise<Note | null> {
    if (!inTauri) {
      for (const [id, n] of mock.notes) {
        if (n.file === file) {
          mock.notes.delete(id);
          const t = { ...n, deleted: deletedAt };
          mock.trash.unshift(t);
          return t;
        }
      }
      return null;
    }
    return invoke<Note | null>("delete_note", { path, file, deletedAt });
  },

  /** Hard delete, bypassing the trash (used for empty notes). */
  async discardNote(path: string, file: string): Promise<void> {
    if (!inTauri) {
      for (const [id, n] of mock.notes) if (n.file === file) mock.notes.delete(id);
      return;
    }
    return invoke("discard_note", { path, file });
  },

  async listTrash(path: string): Promise<Note[]> {
    if (!inTauri) return [...mock.trash];
    return invoke<Note[]>("list_trash", { path });
  },

  async restoreNote(path: string, file: string): Promise<Note> {
    if (!inTauri) {
      const i = mock.trash.findIndex((n) => n.file === file);
      if (i < 0) throw new Error("not in trash");
      const [n] = mock.trash.splice(i, 1);
      const restored = { ...n, deleted: null };
      mock.notes.set(n.id, restored);
      return restored;
    }
    return invoke<Note>("restore_note", { path, file });
  },

  async purgeTrash(path: string, file: string | null): Promise<void> {
    if (!inTauri) {
      mock.trash = file ? mock.trash.filter((n) => n.file !== file) : [];
      return;
    }
    return invoke("purge_trash", { path, file });
  },

  async saveMeta(path: string, meta: MetaPatch): Promise<void> {
    if (!inTauri) {
      Object.assign(mock.meta, meta);
      return;
    }
    return invoke("save_meta", { path, meta });
  },

  // ---- file watching ---------------------------------------------------------

  async watchProject(path: string): Promise<void> {
    if (!inTauri) return;
    return invoke("watch_project", { path });
  },

  async unwatchProject(): Promise<void> {
    if (!inTauri) return;
    return invoke("unwatch_project");
  },

  async readMeta(path: string): Promise<Meta> {
    if (!inTauri) return mock.meta;
    return invoke<Meta>("read_meta", { path });
  },

  /** Receive external changes to the open project. Returns an unsubscribe function. */
  onProjectChanged(cb: (change: ProjectChange) => void): () => void {
    if (!inTauri) return () => {};
    let un: (() => void) | null = null;
    let cancelled = false;
    listen<ProjectChange>("project-changed", (e) => cb(e.payload)).then((u) => (cancelled ? u() : (un = u)));
    return () => {
      cancelled = true;
      un?.();
    };
  },

  // ---- windows & sync --------------------------------------------------------

  /** Broadcast a change to every other window of this app. */
  broadcast(msg: SyncMessage) {
    if (channel) channel.postMessage(msg);
    else emit("dagobert-sync", { ...msg, from: getCurrentWindow().label }).catch(console.error);
  },

  /** Receive changes from other windows. Returns an unsubscribe function. */
  subscribe(cb: (msg: SyncMessage) => void): () => void {
    if (channel) {
      const h = (e: MessageEvent<SyncMessage>) => cb(e.data);
      channel.addEventListener("message", h);
      return () => channel.removeEventListener("message", h);
    }
    let un: (() => void) | null = null;
    let cancelled = false;
    const me = getCurrentWindow().label;
    listen<SyncMessage & { from?: string }>("dagobert-sync", (e) => {
      // Tauri delivers our own emits back to us; ignore those.
      if (e.payload.from !== me) cb(e.payload);
    }).then((u) => (cancelled ? u() : (un = u)));
    return () => {
      cancelled = true;
      un?.();
    };
  },

  /** Open (or focus) a window showing just one note. */
  async openNoteWindow(path: string, id: string, title: string) {
    const url = `index.html?note=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`;
    if (!inTauri) {
      window.open(url, `note-${id}`);
      return;
    }
    const label = `note-${id}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }
    new WebviewWindow(label, { url, title: title || "Untitled", width: 720, height: 800, minWidth: 400, minHeight: 300 });
  },

  /** Show the note's file in Finder / Explorer. */
  async revealNote(path: string, file: string) {
    if (!inTauri) return;
    await revealItemInDir(`${path}/notes/${file}`);
  },

  /** Token from `gh auth token`, if the GitHub CLI is logged in. */
  async githubCliToken(): Promise<string | null> {
    if (!inTauri) return null;
    return (await invoke<string | null>("github_cli_token")) ?? null;
  },

  setWindowTitle(title: string) {
    if (inTauri)
      getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
    else document.title = title;
  },

  closeWindow() {
    if (inTauri)
      getCurrentWindow()
        .close()
        .catch(() => {});
    else window.close();
  },
};
