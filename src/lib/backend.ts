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
import { t } from "./i18n";
import { secrets } from "./secrets";
import type { GitStatus, Local, Meta, MetaPatch, Note, Project, ProjectRef, SyncReport } from "./types";

export const inTauri = "__TAURI_INTERNALS__" in window;

/**
 * Phone-shaped: a coarse pointer on a narrow screen. Deliberately not the OS —
 * it needs no plugin and works the same in the browser dev loop. An iPad lands
 * on the desktop side, which is out of scope rather than broken.
 */
export const isMobile =
  (matchMedia("(pointer: coarse)").matches && innerWidth < 700) ||
  // `npm run dev` + `?mobile` forces it, for layout work without a device.
  (import.meta.env.DEV && new URLSearchParams(location.search).has("mobile"));

/** A change on disk reported by the Rust file watcher. */
export type ProjectChange = { kind: "note"; note: Note } | { kind: "note-removed"; file: string } | { kind: "meta" };

/** Cross-window sync messages. */
export type SyncMessage =
  | { type: "note"; note: Note }
  | { type: "note-file"; id: string; file: string }
  | { type: "note-removed"; id: string }
  | { type: "meta"; meta: MetaPatch };

const channel = inTauri ? null : new BroadcastChannel("dagobert");

/** A small graph so the browser dev loop has something to lay out. */
function seed(): Map<string, Note> {
  const at = new Date().toISOString();
  const notes: Note[] = (
    [
      ["design", "Sketch the layout", ["ui"], [], 40, 40, "Bottom sheet, peek then full.\n\n- [ ] grabber\n- [ ] dismiss"],
      ["touch", "Pinch and pan", ["ui"], ["design"], 340, 0, "Two pointers, midpoint zoom."],
      ["sheet", "Note sheet", ["ui"], ["design"], 340, 160, "Peek shows the title and status."],
      ["creds", "Token credentials", ["git"], [], 40, 300, "HTTPS + a fine-grained PAT."],
      ["clone", "Clone a project", ["git"], ["creds"], 340, 320, "No folder picker on a phone."],
      ["ship", "Put it on the phone", [], ["touch", "sheet", "clone"], 640, 160, "Free Apple ID, 7-day builds."],
    ] as const
  ).map(([id, title, tags, deps, x, y, body]) => ({
    id,
    title,
    tags: [...tags],
    created: at,
    modified: at,
    workflow: null,
    status: id === "design" ? "done" : "todo",
    x,
    y,
    width: null,
    deps: [...deps],
    body,
    file: `${id}.md`,
  }));
  return new Map(notes.map((n) => [n.id, n]));
}

const mock: { notes: Map<string, Note>; trash: Note[]; meta: Meta; local: Local } = {
  notes: seed(),
  trash: [],
  local: { viewport: { x: 0, y: 0, zoom: 1 } },
  meta: {
    tag_colors: {},
    workflows: [],
    default_template: "",
    tracking_template: "",
    repos: {},
    palette: [],
    git: { enabled: false, interval_min: 5 },
  },
};

const mockGitStatus: GitStatus = {
  branch: "main",
  dirty: false,
  ahead: 0,
  behind: 0,
  has_remote: false,
  has_upstream: false,
  last_commit_at: null,
};

export const backend = {
  /** Projects in the app's own data directory (mobile has no folder picker). */
  async listProjects(): Promise<ProjectRef[]> {
    if (!inTauri) return [{ name: "browser-mock", path: "/browser-mock" }];
    return invoke<ProjectRef[]>("list_projects");
  },

  /** Resolves a stored project name against the current container path. */
  async projectPath(name: string): Promise<string | null> {
    if (!inTauri) return name === "browser-mock" ? "/browser-mock" : null;
    return (await invoke<string | null>("project_path", { name })) ?? null;
  },

  /** Clones `url` into the app's data directory, with a commit identity. */
  async cloneProject(url: string): Promise<ProjectRef> {
    if (!inTauri) return { name: "browser-mock", path: "/browser-mock" };
    return invoke<ProjectRef>("clone_project", {
      url,
      token: secrets.gitToken() || null,
      name: secrets.gitName(),
      email: secrets.gitEmail(),
    });
  },

  async pickFolder(): Promise<string | null> {
    if (!inTauri) return "/browser-mock";
    const dir = await openDialog({ directory: true, multiple: false, title: t("welcome.dialogTitle") });
    return typeof dir === "string" ? dir : null;
  },

  async openProject(path: string): Promise<Project> {
    if (!inTauri) return { path, notes: [...mock.notes.values()], meta: mock.meta, local: mock.local };
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

  /** Per-machine state (viewport); separate from `saveMeta` so it never syncs. */
  async saveLocal(path: string, local: Local): Promise<void> {
    if (!inTauri) {
      Object.assign(mock.local, local);
      return;
    }
    return invoke("save_local", { path, local });
  },

  // ---- file watching ---------------------------------------------------------

  /** No watcher on mobile; `SyncReport.pulled` drives `store.reloadFromDisk` instead. */
  async watchProject(path: string): Promise<void> {
    if (!inTauri || isMobile) return;
    return invoke("watch_project", { path });
  },

  async unwatchProject(): Promise<void> {
    if (!inTauri || isMobile) return;
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

  // ---- git tracking ----------------------------------------------------------

  async gitStatus(path: string): Promise<GitStatus> {
    if (!inTauri) return mockGitStatus;
    return invoke<GitStatus>("git_status", { path });
  },

  /** Rejects with "no-repo" when the folder isn't inside a git repository. */
  async gitEnable(path: string): Promise<void> {
    if (!inTauri) return;
    return invoke("git_enable", { path });
  },

  async gitInit(path: string): Promise<void> {
    if (!inTauri) return;
    return invoke("git_init", { path });
  },

  /** Start/stop the Rust-side tick timer. */
  async gitConfigure(enabled: boolean, intervalMin: number): Promise<void> {
    if (!inTauri) return;
    return invoke("git_configure", { enabled, intervalMin });
  },

  /** One full cycle: commit → pull → resolve → push. `stamp` goes in commit messages. */
  async gitSync(path: string, stamp: string): Promise<SyncReport> {
    if (!inTauri) {
      return { committed: false, pulled: "no-remote", pushed: false, conflicts: [], error: null, status: mockGitStatus };
    }
    return invoke<SyncReport>("git_sync", { path, token: secrets.gitToken() || null, stamp });
  },

  /** The final sync before the window closes / the app exits (`path` null = nothing to sync); Rust finishes the quit. */
  async gitQuit(path: string | null, stamp: string, reason: string): Promise<void> {
    if (!inTauri) return;
    return invoke("git_quit", { path, token: secrets.gitToken() || null, stamp, reason });
  },

  /** `git-tick` (timer) and `git-quit` (close/exit held back for a sync) events. */
  onGitEvent(cb: (kind: "tick" | "quit", reason: string) => void): () => void {
    if (!inTauri) return () => {};
    const uns: (() => void)[] = [];
    let cancelled = false;
    listen("git-tick", () => cb("tick", "")).then((u) => (cancelled ? u() : uns.push(u)));
    listen<string>("git-quit", (e) => cb("quit", e.payload)).then((u) => (cancelled ? u() : uns.push(u)));
    return () => {
      cancelled = true;
      for (const u of uns) u();
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
  /** Returns false when there are no windows to open into (mobile uses the sheet). */
  async openNoteWindow(path: string, id: string, title: string): Promise<boolean> {
    if (isMobile) return false;
    const url = `index.html?note=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`;
    if (!inTauri) {
      window.open(url, `note-${id}`);
      return true;
    }
    const label = `note-${id}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return true;
    }
    new WebviewWindow(label, { url, title: title || t("app.untitled"), width: 720, height: 800, minWidth: 400, minHeight: 300 });
    return true;
  },

  /** Show the note's file in Finder / Explorer. */
  async revealNote(path: string, file: string) {
    if (!inTauri || isMobile) return;
    await revealItemInDir(`${path}/notes/${file}`);
  },

  /** Token from `gh auth token`, if the GitHub CLI is logged in. */
  async githubCliToken(): Promise<string | null> {
    if (!inTauri) return null;
    return (await invoke<string | null>("github_cli_token")) ?? null;
  },

  setWindowTitle(title: string) {
    if (isMobile) return;
    if (inTauri)
      getCurrentWindow()
        .setTitle(title)
        .catch(() => {});
    else document.title = title;
  },

  closeWindow() {
    if (isMobile) return;
    if (inTauri)
      getCurrentWindow()
        .close()
        .catch(() => {});
    else window.close();
  },
};
