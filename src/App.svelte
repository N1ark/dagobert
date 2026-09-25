<script lang="ts">
  import { onMount } from "svelte";
  import { nameOf, store } from "./lib/store.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import NotePanel from "./lib/NotePanel.svelte";
  import TagMenu from "./lib/TagMenu.svelte";
  import TrashDialog from "./lib/TrashDialog.svelte";
  import QuickOpen, { type Action } from "./lib/QuickOpen.svelte";
  import WorkflowEditor from "./lib/WorkflowEditor.svelte";
  import PullRequests from "./lib/PullRequests.svelte";
  import GitDialog from "./lib/GitDialog.svelte";
  import CloneDialog from "./lib/CloneDialog.svelte";
  import GitHubSignIn from "./lib/GitHubSignIn.svelte";
  import Sheet from "./lib/Sheet.svelte";
  import { auth } from "./lib/auth.svelte";
  import { updater } from "./lib/updater.svelte";
  import { syncPRs } from "./lib/prs.svelte";
  import { tooltip } from "./lib/tooltip";
  import { relative } from "./lib/time";
  import { stripMarkers } from "./lib/blocks";
  import { backend, isMobile } from "./lib/backend";
  import { demo, DEMO_SELECTED } from "./lib/demo";
  import { ICON } from "./lib/icons";
  import { minimap, toggleMinimap } from "./lib/minimapState.svelte";
  import MapTrifold from "phosphor-svelte/lib/MapTrifold";
  import { setAppMenu, menuSignature } from "./lib/menu";
  import { t, plural } from "./lib/i18n";
  import { keys, matches as pressed } from "./lib/keys";
  import Plus from "phosphor-svelte/lib/Plus";
  import ArrowCounterClockwise from "phosphor-svelte/lib/ArrowCounterClockwise";
  import ArrowClockwise from "phosphor-svelte/lib/ArrowClockwise";
  import TreeStructure from "phosphor-svelte/lib/TreeStructure";
  import Crosshair from "phosphor-svelte/lib/Crosshair";
  import Sparkle from "phosphor-svelte/lib/Sparkle";
  import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
  import Terminal from "phosphor-svelte/lib/Terminal";
  import FolderOpen from "phosphor-svelte/lib/FolderOpen";
  import GithubLogo from "phosphor-svelte/lib/GithubLogo";
  import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
  import Kanban from "phosphor-svelte/lib/Kanban";
  import CheckSquare from "phosphor-svelte/lib/CheckSquare";
  import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
  import Copy from "phosphor-svelte/lib/Copy";
  import ClipboardText from "phosphor-svelte/lib/ClipboardText";
  import CopySimple from "phosphor-svelte/lib/CopySimple";
  import Trash from "phosphor-svelte/lib/Trash";
  import CornersOut from "phosphor-svelte/lib/CornersOut";
  import X from "phosphor-svelte/lib/X";
  import GitBranch from "phosphor-svelte/lib/GitBranch";
  import GearSix from "phosphor-svelte/lib/GearSix";
  import ArrowsClockwise from "phosphor-svelte/lib/ArrowsClockwise";
  import CloudArrowUp from "phosphor-svelte/lib/CloudArrowUp";
  import Warning from "phosphor-svelte/lib/Warning";
  import CloudArrowDown from "phosphor-svelte/lib/CloudArrowDown";
  import ArrowCircleUp from "phosphor-svelte/lib/ArrowCircleUp";
  import type { ProjectRef } from "./lib/types";

  // `?note=<id>&path=<project>` turns this window into a standalone note view.
  const params = new URLSearchParams(location.search);
  const standaloneId = params.get("note");
  const standalonePath = params.get("path");

  syncPRs();

  // Focus mode: dim everything outside the selected note's chain.
  const FOCUS_KEY = "dagobert.focus";
  let focus = $state(localStorage.getItem(FOCUS_KEY) !== "0");
  function toggleFocus() {
    focus = !focus;
    localStorage.setItem(FOCUS_KEY, focus ? "1" : "0");
  }

  // Background grain shader (Grain.svelte); purely cosmetic.
  const GRAIN_KEY = "dagobert.grain";
  // Off by default on a phone: a cosmetic shader isn't worth the battery.
  let grain = $state(isMobile ? localStorage.getItem(GRAIN_KEY) === "1" : localStorage.getItem(GRAIN_KEY) !== "0");
  function toggleGrain() {
    grain = !grain;
    localStorage.setItem(GRAIN_KEY, grain ? "1" : "0");
  }

  // Left sidebar listing the GitHub PRs referenced across notes.
  const PRS_KEY = "dagobert.prs";
  const PRS_W_KEY = "dagobert.prsWidth";
  // Remembered where it's a sidebar; a phone opens with nothing over the canvas.
  let showPRs = $state(!isMobile && localStorage.getItem(PRS_KEY) === "1");
  let prsW = $state(Number(localStorage.getItem(PRS_W_KEY)) || 300);

  /** Pointer handlers for a resizer that drags a width, remembered under `key` once let go. */
  function widthDrag(key: string, width: () => number, resize: (startW: number, dx: number) => void) {
    let from = $state<{ x: number; w: number } | null>(null);
    return {
      get active() {
        return !!from;
      },
      down(e: PointerEvent) {
        e.preventDefault(); // otherwise the drag also starts a text selection
        from = { x: e.clientX, w: width() };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      },
      move(e: PointerEvent) {
        if (from) resize(from.w, e.clientX - from.x);
      },
      up() {
        if (!from) return;
        from = null;
        localStorage.setItem(key, String(width()));
      },
    };
  }

  /** Shift the viewport with the canvas's left edge so the graph stays put on screen. */
  function absorb(dx: number) {
    if (!store.path || !dx) return;
    store.viewport.x -= dx;
    store.saveViewport();
  }
  function togglePRs() {
    showPRs = !showPRs;
    // A phone opens it as a sheet: nothing to push aside, and nothing to remember.
    if (isMobile) {
      if (showPRs) store.sheetFull = true;
      return;
    }
    localStorage.setItem(PRS_KEY, showPRs ? "1" : "0");
    absorb(showPRs ? prsW : -prsW);
  }
  const prsDrag = widthDrag(
    PRS_W_KEY,
    () => prsW,
    (w0, dx) => {
      const w = Math.round(Math.max(220, Math.min(window.innerWidth * 0.5, w0 + dx)));
      absorb(w - prsW);
      prsW = w;
    },
  );

  const PANEL_KEY = "dagobert.panelWidth";
  let panelW = $state(Number(localStorage.getItem(PANEL_KEY)) || 440);
  const panelDrag = widthDrag(
    PANEL_KEY,
    () => panelW,
    (w0, dx) => (panelW = Math.round(Math.max(320, Math.min(window.innerWidth * 0.8, w0 - dx)))),
  );

  // The phone has no folder picker: projects live in the app's data directory.
  let projects = $state<ProjectRef[]>([]);
  let showClone = $state(false);
  $effect(() => {
    if (isMobile && !store.path) backend.listProjects().then((p) => (projects = p), console.error);
  });

  let canvas = $state<Canvas | null>(null);
  let query = $state("");
  let searchEl = $state<HTMLInputElement | null>(null);
  let showTrash = $state(false);
  let showQuickOpen = $state(false);
  /** Which pane the palette shows. */
  let paletteMode = $state<"notes" | "commands">("notes");

  /** Once per keystroke: the menu accelerator and the window handler both fire for a key. */
  const lastRun = new Map<string, number>();
  function once(id: string, fn: () => void) {
    const now = Date.now();
    if (now - (lastRun.get(id) ?? 0) < 150) return;
    lastRun.set(id, now);
    fn();
  }

  function openPalette(mode: "notes" | "commands") {
    if (showQuickOpen && paletteMode === mode) showQuickOpen = false;
    else {
      paletteMode = mode;
      showQuickOpen = true;
    }
  }
  let showWorkflows = $state(false);
  let settingsSection = $state<"workflows" | "tracking" | "github" | "git">("workflows");
  let settingsWorkflow = $state<string | null | undefined>(undefined);

  function openSettings(section: typeof settingsSection, workflow?: string | null) {
    settingsSection = section;
    settingsWorkflow = workflow;
    showWorkflows = true;
  }
  store.openSettings = openSettings;

  function hidePanels() {
    showWorkflows = false;
    showTrash = false;
    showPRs = false;
  }

  $effect(() => {
    if (isMobile && (showWorkflows || showTrash)) store.sheetFull = true;
  });

  /** The phone shows exactly one panel; this is which. */
  const mobilePanel = $derived(
    !isMobile || !store.path ? null : showWorkflows ? "settings" : showTrash ? "trash" : showPRs ? "prs" : store.selected ? "note" : null,
  );
  let sheet = $state<Sheet | null>(null);
  /** Canvas taps ask the panel to leave, so it animates out. */
  store.dismissPanel = () => sheet?.dismiss();

  /** Dismissing is dismissing: there is no stack to pop back to. */
  function closePanel() {
    hidePanels();
    store.select(null);
  }

  /** Tooltip for the git status item in the toolbar. */
  function gitTip() {
    if (store.gitState === "syncing") return t("toolbar.git.syncing");
    if (store.gitState === "error") return t("toolbar.git.failed", { error: store.gitError ?? t("toolbar.git.unknownError") });
    const st = store.gitStatus;
    const when = store.gitLastSync ? t("toolbar.git.lastSync", { when: relative(store.gitLastSync) }) : t("toolbar.git.notSynced");
    if (st && !st.has_remote) return t("toolbar.git.local", { when });
    const position = st && (st.ahead || st.behind) ? t("toolbar.git.position", { ahead: st.ahead, behind: st.behind }) : "";
    return t("toolbar.git.remote", { branch: st?.branch ?? "", position, when, key: keys["git-sync"] });
  }

  // Notes that pass the search box AND the tag filter; null when neither is active.
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const tags = store.tagFilter;
    if (!q && !tags.length) return null;
    const terms = q.split(/\s+/).filter(Boolean);
    return new Set(
      store.notes
        .filter((n) => !tags.length || n.tags.some((t) => tags.includes(t)))
        .filter((n) => {
          const hay = `${n.title} ${n.tags.map((t) => "#" + t).join(" ")} ${stripMarkers(n.body)}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
        .map((n) => n.id),
    );
  });

  const stats = $derived({
    total: store.notes.length,
    done: store.notes.filter((n) => store.isDone(n)).length,
    ready: store.notes.filter((n) => store.isReady(n)).length,
  });

  function jump(id: string) {
    // First, so nothing below can throw and leave the note behind an open panel.
    if (isMobile) {
      hidePanels();
      store.sheetFull = true;
    }
    store.select(id);
    canvas?.focusNode(id);
  }
  store.jump = jump;

  /** World coords of the visible canvas centre (for creating notes from the palette). */
  function viewCenter() {
    const r = document.querySelector(".canvas")?.getBoundingClientRect();
    const vp = store.viewport;
    const w = r?.width ?? window.innerWidth;
    const h = r?.height ?? window.innerHeight;
    return { x: (w / 2 - vp.x) / vp.zoom - 110, y: (h / 2 - vp.y) / vp.zoom - 20 };
  }

  function createTitled(title: string) {
    const c = viewCenter();
    const n = store.create(Math.round(c.x), Math.round(c.y), { title });
    jump(n.id);
  }

  const paletteActions = $derived.by((): Action[] => {
    const sel = store.selected;
    const has = !!store.path;
    const a = (id: string, label: string, run: () => void, extra: Partial<Action> = {}): Action => ({
      id,
      label,
      run: () => once(id, run),
      ...extra,
    });
    const actions = [
      a("new-note", t("action.new-note"), () => canvas?.createAtCenter(), {
        hint: keys["new-note"],
        icon: Plus,
        symbol: ["plus"],
        menu: "File",
        enabled: has,
      }),
      a("open-folder", t("action.open-folder"), () => store.pickAndOpen(), {
        hint: keys["open-folder"],
        icon: FolderOpen,
        symbol: ["folder"],
        menu: "File",
      }),
      a("git-sync", t("action.git-sync"), () => store.syncNow(true), {
        hint: keys["git-sync"],
        icon: CloudArrowUp,
        symbol: ["arrow.triangle.2.circlepath", "arrow.clockwise"],
        menu: "File",
        enabled: has && store.gitEnabled,
      }),
      a(
        "git-toggle",
        t(store.gitEnabled ? "action.git-toggle.disable" : "action.git-toggle.enable"),
        () => (store.gitEnabled ? store.disableGit() : store.enableGit()),
        {
          icon: GitBranch,
          symbol: ["arrow.triangle.branch"],
          menu: "File",
          menuLabel: t("action.git-toggle.menu"),
          enabled: has,
        },
      ),
      a("undo", t("action.undo"), () => editUndo("undo"), {
        hint: keys.undo,
        icon: ArrowCounterClockwise,
        symbol: ["arrow.uturn.backward"],
        menu: "Edit",
        enabled: has,
      }),
      a("redo", t("action.redo"), () => editUndo("redo"), {
        hint: keys.redo,
        icon: ArrowClockwise,
        symbol: ["arrow.uturn.forward"],
        menu: "Edit",
        enabled: has,
      }),
      a(
        "toggle-done",
        sel
          ? t("action.toggle-done.selected", {
              verb: t(store.isDone(sel) ? "node.markNotDone" : "node.markDone"),
              title: sel.title || t("app.untitled"),
            })
          : t("action.toggle-done"),
        () => {
          const n = store.selected;
          if (n) store.setDone(n.id, !store.isDone(n));
        },
        {
          icon: CheckSquare,
          symbol: ["checkmark.square"],
          menu: "Note",
          menuLabel: t("action.toggle-done"),
          enabled: !!sel && !sel.tracking,
        },
      ),
      a("open-window", t("action.open-window"), () => store.selectedId && store.openInWindow(store.selectedId), {
        icon: ArrowSquareOut,
        symbol: ["macwindow.badge.plus", "macwindow"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("reveal", t("action.reveal"), () => store.selectedId && store.revealInFinder(store.selectedId), {
        icon: FolderOpen,
        symbol: ["folder.badge.questionmark", "folder"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("copy-note", t("action.copy-note"), () => store.selectedId && store.copy(store.selectedId), {
        icon: Copy,
        symbol: ["doc.on.doc"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("duplicate", t("action.duplicate"), () => duplicateSelected(), {
        hint: keys.duplicate,
        icon: CopySimple,
        symbol: ["plus.square.on.square"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("paste-note", t("action.paste-note"), () => pasteNote(), {
        icon: ClipboardText,
        symbol: ["doc.on.clipboard"],
        menu: "Note",
        enabled: has && !!store.clipboard,
      }),
      a("quick-open", t("action.quick-open"), () => openPalette("notes"), {
        hint: keys["quick-open"],
        icon: MagnifyingGlass,
        symbol: ["magnifyingglass"],
        menu: "View",
        enabled: has,
      }),
      a("commands", t("action.commands"), () => openPalette("commands"), {
        hint: keys.commands,
        icon: Terminal,
        symbol: ["terminal", "command"],
        menu: "View",
        enabled: has,
      }),
      a("search", t("action.search"), () => (searchEl?.focus(), searchEl?.select()), {
        hint: keys.search,
        icon: MagnifyingGlass,
        symbol: ["text.magnifyingglass", "magnifyingglass"],
        menu: "View",
        enabled: has,
      }),
      a("fit", t("action.fit"), () => canvas?.fitAll(), {
        icon: CornersOut,
        symbol: ["arrow.up.left.and.arrow.down.right"],
        menu: "View",
        enabled: has,
      }),
      a("tidy", t("action.tidy"), () => canvas?.tidy(), {
        icon: TreeStructure,
        symbol: ["rectangle.3.group", "square.grid.2x2"],
        menu: "View",
        enabled: has,
      }),
      a("focus", t(focus ? "action.focus.disable" : "action.focus.enable"), () => toggleFocus(), {
        icon: Crosshair,
        symbol: ["scope"],
        menu: "View",
        menuLabel: t("action.focus.menu"),
        enabled: has,
      }),
      a("grain", t(grain ? "action.grain.disable" : "action.grain.enable"), () => toggleGrain(), {
        icon: Sparkle,
        symbol: ["sparkles"],
        menu: "View",
        menuLabel: t("action.grain.menu"),
      }),
      a("trash", t("action.trash"), () => (showTrash = true), { icon: Trash, symbol: ["trash"], menu: "Tools", enabled: has }),
      a(
        "update",
        updater.ready ? t("action.update.install", { version: updater.ready }) : t("action.update.check"),
        () => (updater.ready ? updater.install() : updater.check(true)),
        { icon: ArrowCircleUp, symbol: ["arrow.down.circle"], menu: "App" },
      ),
      a("settings", t("action.settings"), () => openSettings("github"), {
        hint: keys.settings,
        icon: GearSix,
        symbol: ["gearshape", "gear"],
        menu: "App",
        enabled: has,
      }),
      a("workflows", t("action.workflows"), () => openSettings("workflows"), {
        icon: Kanban,
        symbol: ["list.bullet.rectangle", "list.bullet"],
        menu: "Tools",
        enabled: has,
      }),
      a("prs", t(showPRs ? "action.prs.hide" : "action.prs.show"), () => togglePRs(), {
        hint: keys.prs,
        icon: GitPullRequest,
        symbol: ["arrow.triangle.pull", "arrow.triangle.branch"],
        menu: "View",
        menuLabel: t("action.prs.menu"),
        enabled: has,
      }),
      a("github", t("action.github"), () => openSettings("github"), {
        icon: GithubLogo,
        symbol: ["link"],
        menu: "Tools",
        enabled: has,
      }),
      a("git-settings", t("action.git-settings"), () => openSettings("git"), {
        icon: GitBranch,
        symbol: ["arrow.triangle.branch"],
        menu: "Tools",
        enabled: has,
      }),
    ];
    // No tracking toggle and nothing to reveal in: a phone has neither.
    return isMobile ? actions.filter((x) => x.id !== "git-toggle" && x.id !== "reveal" && x.id !== "update") : actions;
  });

  /** Undo/redo from the menu: native inside text fields, ours elsewhere. */
  function editUndo(kind: "undo" | "redo") {
    const el = document.activeElement as HTMLElement | null;
    if (el && el.closest("input, textarea, [contenteditable]")) document.execCommand(kind);
    else if (kind === "undo") store.undo();
    else store.redo();
  }

  function duplicateSelected() {
    if (!store.selectedId) return;
    const n = store.duplicate(store.selectedId);
    if (n) jump(n.id);
  }

  function pasteNote() {
    const c = viewCenter();
    const n = store.paste(Math.round(c.x), Math.round(c.y));
    if (n) jump(n.id);
  }

  // Rebuild the native menu only when what it shows, or the appearance, changes.
  let menuSig = "";
  let appearance = $state(window.matchMedia("(prefers-color-scheme: dark)").matches);
  onMount(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => (appearance = mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  });
  $effect(() => {
    if (standaloneId) return;
    const actions = paletteActions;
    const sig = `${appearance}|${menuSignature(actions)}`;
    if (sig === menuSig) return;
    menuSig = sig;
    setAppMenu(actions).catch((e) => console.error("menu", e));
  });

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === "Enter" && matches?.size) {
      jump([...matches][0]);
    } else if (e.key === "Escape") {
      query = "";
      searchEl?.blur();
    }
  }

  // Keep a standalone window's title in step with the note.
  $effect(() => {
    if (standaloneId && store.selected) backend.setWindowTitle(store.selected.title || t("app.untitled"));
  });

  /** Shortcuts handled at the window level (the rest live in Canvas / the editor). */
  const WINDOW_KEYS = ["new-note", "commands", "quick-open", "prs", "search", "open-folder", "git-sync", "settings"] as const;
  function onKey(e: KeyboardEvent) {
    if (standaloneId) return;
    const id = WINDOW_KEYS.find((k) => pressed(keys[k], e));
    if (!id) return;
    const action = paletteActions.find((a) => a.id === id);
    if (!action || action.enabled === false) return;
    e.preventDefault();
    action.run();
  }

  onMount(() => {
    const unsub = backend.subscribe((m) => store.applySync(m));
    const unwatch = backend.onProjectChanged((c) => store.applyExternal(c));
    const ungit = standaloneId
      ? () => {}
      : backend.onGitEvent((kind, reason) => (kind === "tick" ? store.syncNow(false) : store.quitSync(reason)));
    if (standaloneId && standalonePath) {
      store.syncs = false;
      store.open(standalonePath).then(() => store.select(standaloneId));
    } else if (demo) {
      store.open("/atlas").then(() => {
        store.select(DEMO_SELECTED);
        requestAnimationFrame(() => canvas?.fitAll());
      });
    } else {
      store.restore();
    }
    const unupdate = standaloneId || demo ? () => {} : updater.start();
    window.addEventListener("keydown", onKey);
    // Flush pending debounced saves whenever the page may be going away.
    const flush = () => store.flushAll();
    // There is no quit on mobile, only background and foreground.
    const lifecycle = isMobile && !standaloneId;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") lifecycle && store.resume();
      else if (lifecycle) void store.suspend();
      else flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsub();
      unwatch();
      ungit();
      unupdate();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
</script>

{#if standaloneId}
  <div class="standalone">
    {#if store.selected}
      {#key store.selected.id}
        <NotePanel note={store.selected} onjump={(id) => store.select(id)} standalone />
      {/key}
    {:else if store.path}
      <div class="gone">{t("standalone.gone")}</div>
    {/if}
  </div>
{:else if store.path}
  <div class="app">
    <div class="toolbar" data-tauri-drag-region={isMobile ? undefined : true}>
      <div class="brand" data-tauri-drag-region={isMobile ? undefined : true}>
        {#if isMobile}
          <!-- The mark is the way back to the project list; there is no menu to hold one. -->
          <button class="ghost icon" onclick={() => store.close()} aria-label={t("toolbar.projects")}>
            <img class="mark" src="/icon.svg" alt="" draggable="false" />
          </button>
        {:else}
          <img class="mark" src="/icon.svg" alt="" draggable="false" />
          <span class="logo">{t("app.name")}</span>
          <span class="sep">/</span>
          <button class="ghost project" onclick={() => store.close()} title={store.path}>{store.projectName}</button>
        {/if}
      </div>
      {#if !isMobile}
        <input
          class="search"
          placeholder={t("toolbar.search.placeholder", { search: keys.search, quickOpen: keys["quick-open"] })}
          bind:value={query}
          bind:this={searchEl}
          onkeydown={onSearchKey}
        />
        {#if matches}
          <span class="hint">{plural("toolbar.matches", matches.size)}</span>
        {/if}
      {/if}
      <div class="spacer" data-tauri-drag-region={isMobile ? undefined : true}></div>
      {#if updater.ready && !isMobile}
        <button class="ghost update" onclick={() => updater.install()} use:tooltip={t("toolbar.update.tip", { version: updater.ready })}
          ><ArrowCircleUp size={ICON} /> {t("toolbar.update")}</button
        >
      {/if}
      <span class="stats" class:hide={isMobile} title={t("toolbar.stats.title")}>
        <span class="ready">{t("toolbar.stats.ready", { n: stats.ready })}</span> · {t("toolbar.stats.done", {
          done: stats.done,
          total: stats.total,
        })}
        {#if store.conflictIds.size}
          · <button class="conflicts" onclick={() => store.nextConflict()} use:tooltip={t("toolbar.conflicts.tip")}
            ><Warning size={12} weight="fill" /> {store.conflictIds.size}</button
          >
        {/if}
      </span>
      {#if store.gitEnabled}
        <button
          class="ghost icon git"
          class:syncing={store.gitState === "syncing"}
          class:error={store.gitState === "error"}
          class:local={store.gitStatus ? !store.gitStatus.has_remote : false}
          onclick={() => store.syncNow(true)}
          use:tooltip={gitTip}
          aria-label={t("toolbar.git.aria")}
        >
          {#if store.gitState === "syncing"}<span class="spin"><ArrowsClockwise size={ICON} /></span>{:else}<GitBranch size={ICON} />{/if}
        </button>
      {/if}
      <TagMenu />
      {#if isMobile}
        <button class="ghost icon" class:on={minimap.open} onclick={toggleMinimap} aria-label={t("minimap.toggle")}
          ><MapTrifold size={ICON} /></button
        >
        <button class="ghost icon" onclick={() => openPalette("commands")} aria-label={t("toolbar.more")}><Terminal size={ICON} /></button>
      {:else}
        <button class="ghost icon" onclick={() => (showTrash = true)} use:tooltip={t("toolbar.trash")} aria-label={t("toolbar.trash")}
          ><Trash size={ICON} /></button
        >
        <button
          class="ghost icon"
          class:on={showPRs}
          onclick={togglePRs}
          use:tooltip={t("toolbar.prs.tip", { key: keys.prs })}
          aria-label={t("toolbar.prs")}><GitPullRequest size={ICON} /></button
        >
        <button
          class="ghost icon"
          class:on={focus}
          onclick={toggleFocus}
          use:tooltip={t("toolbar.focus.tip")}
          aria-label={t("toolbar.focus")}><Crosshair size={ICON} /></button
        >
        <button class="ghost icon" onclick={() => canvas?.tidy()} use:tooltip={t("toolbar.tidy.tip")} aria-label={t("toolbar.tidy")}
          ><TreeStructure size={ICON} /></button
        >
        <button class="ghost icon" onclick={() => canvas?.fitAll()} use:tooltip={t("toolbar.fit.tip")} aria-label={t("toolbar.fit")}
          ><CornersOut size={ICON} /></button
        >
      {/if}
      {#if !isMobile}
        <button
          class="primary icon"
          onclick={() => canvas?.createAtCenter()}
          use:tooltip={t("toolbar.new.tip", { key: keys["new-note"] })}
          aria-label={t("toolbar.new")}><Plus size={ICON} weight="bold" /></button
        >
      {/if}
    </div>
    <div class="main" class:resizing={panelDrag.active || prsDrag.active} style="--panel-w:{panelW}px; --prs-w:{prsW}px">
      {#if showPRs && !isMobile}
        <PullRequests onclose={togglePRs} onjump={jump} />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resizer left"
          class:active={prsDrag.active}
          onpointerdown={prsDrag.down}
          onpointermove={prsDrag.move}
          onpointerup={prsDrag.up}
          onpointercancel={prsDrag.up}
        ></div>
      {/if}
      <Canvas bind:this={canvas} {matches} {focus} {grain} />
      {#if store.selected && !isMobile}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="resizer"
          class:active={panelDrag.active}
          onpointerdown={panelDrag.down}
          onpointermove={panelDrag.move}
          onpointerup={panelDrag.up}
          onpointercancel={panelDrag.up}
        ></div>
        <div class="panel-wrap">
          {#key store.selected.id}
            <NotePanel note={store.selected} onjump={jump} />
          {/key}
        </div>
      {/if}
    </div>
    {#if isMobile}
      <!-- Rides above a peeking sheet, and gets out of the way of a full one. -->
      <div class="bottombar" class:tucked={!!mobilePanel && store.sheetFull}>
        <button class="ghost icon" onclick={() => openPalette("notes")} aria-label={t("action.quick-open")}
          ><MagnifyingGlass size={ICON} /></button
        >
        <button class="primary icon create" onclick={() => canvas?.createAtCenter()} aria-label={t("toolbar.new")}
          ><Plus size={ICON} weight="bold" /></button
        >
        <button class="ghost icon" class:on={showPRs} onclick={togglePRs} aria-label={t("toolbar.prs")}
          ><GitPullRequest size={ICON} /></button
        >
      </div>
      {#if mobilePanel}
        <Sheet bind:this={sheet} bind:full={store.sheetFull} onclose={closePanel}>
          {#if mobilePanel === "note" && store.selected}
            {#key store.selected.id}
              <NotePanel note={store.selected} onjump={jump} />
            {/key}
          {:else if mobilePanel === "prs"}
            <PullRequests sheet onclose={togglePRs} onjump={jump} />
          {:else if mobilePanel === "trash"}
            <TrashDialog sheet onclose={() => (showTrash = false)} onrestored={(id) => jump(id)} />
          {:else if mobilePanel === "settings"}
            <WorkflowEditor sheet section={settingsSection} workflow={settingsWorkflow} onclose={() => (showWorkflows = false)} />
          {/if}
        </Sheet>
      {/if}
    {/if}
  </div>
{:else}
  <div class="welcome" data-tauri-drag-region={isMobile ? undefined : true}>
    <div class="card">
      <img class="hero" src="/logo.svg" alt="" draggable="false" />
      <h1>{t("app.name")}</h1>
      <p class="tagline">{t("welcome.tagline")}</p>
      {#if isMobile}
        {#if auth.signedIn}
          <button class="primary big" onclick={() => (showClone = true)}><CloudArrowDown size={16} /> {t("welcome.clone")}</button>
        {:else}
          <p class="hint">{t("welcome.signin.help")}</p>
        {/if}
        <GitHubSignIn compact />
        <h3>{t("welcome.projects")}</h3>
        {#if projects.length}
          <ul class="recent">
            {#each projects as p (p.name)}
              <li>
                <button class="ghost path" onclick={() => store.open(p.path)}><span class="name">{p.name}</span></button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">{t("welcome.noProjects")}</p>
        {/if}
      {:else}
        <button class="primary big" onclick={() => store.pickAndOpen()}>{t("welcome.open")}</button>
        <p class="hint">{t("welcome.hint")}</p>
        {#if store.recent.length}
          <h3>{t("welcome.recent")}</h3>
          <ul class="recent">
            {#each store.recent as r (r)}
              <li>
                <button class="ghost path" onclick={() => store.openRef(r)} title={r}>
                  <span class="name">{nameOf(r)}</span>
                  <span class="full">{r}</span>
                </button>
                <button class="ghost forget" onclick={() => store.forgetRecent(r)} aria-label={t("welcome.forget")}><X size={14} /></button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if showClone}
  <CloneDialog onclose={() => (showClone = false)} />
{/if}

{#if showQuickOpen}
  {#key paletteMode}
    <QuickOpen mode={paletteMode} actions={paletteActions} onjump={jump} oncreate={createTitled} onclose={() => (showQuickOpen = false)} />
  {/key}
{/if}

{#if showWorkflows && !isMobile}
  <WorkflowEditor section={settingsSection} onclose={() => (showWorkflows = false)} />
{/if}

{#if store.needsRepo}
  <GitDialog kind="norepo" onclose={() => (store.needsRepo = false)} />
{:else if store.conflictReport}
  <GitDialog kind="conflicts" conflicts={store.conflictReport} onclose={() => (store.conflictReport = null)} />
{/if}

{#if showTrash && !isMobile}
  <TrashDialog
    onclose={() => (showTrash = false)}
    onrestored={(id) => {
      showTrash = false;
      jump(id);
    }}
  />
{/if}

<div class="toast-wrap">
  {#if store.error}
    <div class="toast">{store.error}</div>
  {:else if store.notice}
    <div class="toast notice">{store.notice}</div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }
  .toolbar {
    height: var(--toolbar-h);
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 84px; /* room for macOS traffic lights */
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    -webkit-user-select: none;
    user-select: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
  }
  .mark {
    width: var(--mark);
    height: var(--mark);
    opacity: 0.9;
  }
  .logo {
    font-weight: 700;
    color: var(--color2);
    background: linear-gradient(90deg, var(--accent2), #d98adf);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .sep {
    color: #444;
  }
  .project {
    padding: 2px 6px;
    color: var(--color);
  }
  .search {
    width: 260px;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--bg);
  }
  .hint {
    font-size: 11px;
    color: var(--color-dim);
  }
  .spacer {
    flex: 1;
  }
  .toolbar button.on {
    color: var(--accent2);
  }
  .stats.hide {
    display: none;
  }
  .stats {
    font-size: 12px;
    color: var(--color-dim);
    margin-right: 4px;
  }
  .stats .ready {
    color: var(--accent2);
  }
  .update {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    font-size: 12px;
    color: var(--accent2);
  }
  .conflicts {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    font-size: 12px;
    color: var(--yellow);
  }
  .git.local {
    color: var(--color-dim);
  }
  .git.error {
    color: var(--red);
  }
  .git.syncing {
    color: var(--accent2);
  }
  .spin {
    display: inline-flex;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .panel-wrap {
    display: contents;
  }

  /* Floats over the canvas rather than taking a strip of it. */
  .bottombar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(8px + var(--safe-bottom));
    z-index: 4;
    display: flex;
    justify-content: space-evenly;
    align-items: center;
    pointer-events: none;
    /* Follows the sheet: the vars are live while one is on screen. */
    transform: translateY(calc(24px * var(--sheet-dim, 0) - var(--sheet-lift, 0px)));
    opacity: calc(1 - var(--sheet-dim, 0));
    transition:
      transform var(--dur-sheet) var(--ease-sheet),
      opacity 0.2s ease;
  }
  :global(body.sheet-dragging) .bottombar {
    transition: none;
  }
  .bottombar.tucked button {
    pointer-events: none;
  }
  .bottombar button {
    pointer-events: auto;
    border-radius: 999px;
    box-shadow: var(--shadow-lg);
  }
  .bottombar button.ghost {
    background: var(--bg2);
  }
  .bottombar .create {
    width: 56px;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .main.resizing {
    -webkit-user-select: none;
    user-select: none;
    cursor: col-resize;
  }
  .resizer {
    flex: none;
    width: 5px;
    margin-right: -5px;
    z-index: 5;
    cursor: col-resize;
    transition: background 0.15s;
  }
  .resizer.left {
    margin-right: 0;
    margin-left: -5px;
  }
  .resizer:hover,
  .resizer.active {
    background: var(--accent);
  }
  .standalone {
    height: 100%;
    display: flex;
  }
  .standalone :global(.panel) {
    width: 100%;
    border-left: none;
  }
  .gone {
    margin: auto;
    color: var(--color-dim);
  }

  .welcome {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(ellipse at 20% 0%, #45155166, transparent 60%), radial-gradient(ellipse at 80% 100%, #421a4066, transparent 60%),
      var(--bg);
  }
  :global(body.mobile) .welcome {
    padding: calc(var(--safe-top) + 12px) 16px calc(var(--safe-bottom) + 12px);
    align-items: flex-start;
    overflow: auto;
  }
  :global(body.mobile) .card {
    width: 100%;
    padding: 24px 20px;
  }
  .card {
    -webkit-user-select: none;
    user-select: none;
    width: 380px;
    padding: 32px;
    background: var(--bg2);
    border-radius: 12px;
    box-shadow: var(--shadow-lg);
    text-align: center;
  }
  .hero {
    width: 96px;
    height: 96px;
    margin: -8px auto 12px;
    display: block;
    filter: drop-shadow(0 8px 24px #8a2aa244);
  }
  .card h1 {
    margin: 0;
    font-size: 32px;
    color: var(--color2);
    background: linear-gradient(90deg, var(--accent2), #d98adf);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .tagline {
    margin: 4px 0 24px;
    color: var(--color-dim);
  }
  .big {
    font-size: 15px;
    padding: 8px 20px;
  }
  .card .hint {
    margin: 12px 0 0;
    font-size: 12px;
  }
  .card h3 {
    margin: 28px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-dim);
    text-align: left;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    text-align: left;
  }
  .recent li {
    display: flex;
    align-items: center;
  }
  .path {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    min-width: 0;
    color: var(--color);
  }
  .path .name {
    color: var(--color2);
  }
  .path .full {
    font-size: 11px;
    color: #555;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
  }
  .forget {
    padding: 2px 8px;
  }

  /* Centred over everything, and above the phone's floating actions. */
  .toast-wrap {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(20px + var(--safe-bottom));
    z-index: 100;
    display: flex;
    justify-content: center;
    padding: 0 16px;
    pointer-events: none;
  }
  :global(body.mobile) .toast-wrap {
    bottom: calc(var(--safe-bottom) + var(--btn) + 24px);
  }
  .toast.notice {
    border-color: var(--border2);
    color: var(--color);
  }
  .toast {
    max-width: 100%;
    background: var(--bg3);
    border: 1px solid var(--red);
    color: var(--color2);
    padding: 8px 14px;
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    animation: toast-in 0.24s var(--ease-sheet);
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }
</style>
