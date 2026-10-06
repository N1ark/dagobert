<script lang="ts">
  import { onMount } from "svelte";
  import { nameOf, store } from "./lib/store.svelte";
  import Canvas from "./lib/Canvas.svelte";
  import NotePanel from "./lib/NotePanel.svelte";
  import TagMenu from "./lib/TagMenu.svelte";
  import type { Action } from "./lib/menu";
  import GitHubSignIn from "./lib/GitHubSignIn.svelte";
  import Dock from "./lib/Dock.svelte";
  import Tiles from "./lib/Tiles.svelte";
  import { layout } from "./lib/panes.svelte";
  import { PANE_LABEL, PANES, type Pane } from "./lib/tiles";
  import { auth } from "./lib/auth.svelte";
  import { updater, readyVersion, checkNow, install } from "./lib/updater.svelte";
  import { syncPRs } from "./lib/prs.svelte";
  import { ContextMenuHost, IconButton, persistedFlag, Sheet, ToastHost, tooltip } from "purr";
  import { relative } from "./lib/time";
  import { stripMarkers } from "./lib/blocks";
  import { stripMedia, type MediaDrop } from "./lib/media";
  import { backend, isMobile } from "./lib/backend";
  import { demo, DEMO_SELECTED } from "./lib/demo";
  import { minimap, toggleMinimap } from "./lib/minimapState.svelte";
  import {
    MapTrifold,
    Plus,
    ArrowCounterClockwise,
    ArrowClockwise,
    TreeStructure,
    Crosshair,
    Sparkle,
    MagnifyingGlass,
    Terminal,
    FolderOpen,
    GithubLogo,
    GitPullRequest,
    Kanban,
    CheckSquare,
    ArrowSquareOut,
    Copy,
    ImageSquare,
    Images,
    ClipboardText,
    CopySimple,
    Trash,
    CornersOut,
    X,
    GitBranch,
    GearSix,
    ArrowsClockwise,
    CloudArrowUp,
    Warning,
    CloudArrowDown,
    ArrowCircleUp,
    CalendarBlank,
    CalendarCheck,
    CalendarMinus,
  } from "purr/icons";
  import { setAppMenu, menuSignature } from "./lib/menu";
  import { t, plural } from "./lib/i18n";
  import { keys } from "./lib/keys";
  import { matches as pressed } from "purr";
  import type { ProjectRef } from "./lib/types";
  import { dueState } from "./lib/calendar";
  import { clock } from "./lib/clock.svelte";

  // `?note=<id>&path=<project>` turns this window into a standalone note view.
  const params = new URLSearchParams(location.search);
  const standaloneId = params.get("note");
  const standalonePath = params.get("path");

  syncPRs();

  // Focus mode: dim everything outside the selected note's chain.
  const focusMode = persistedFlag("dagobert.focus", true);
  const focus = $derived(focusMode.value);
  const toggleFocus = () => (focusMode.value = !focusMode.value);

  // Background grain shader (Grain.svelte); purely cosmetic.
  // Off by default on a phone: a cosmetic shader isn't worth the battery.
  const grainMode = persistedFlag("dagobert.grain", !isMobile);
  const grain = $derived(grainMode.value);
  const toggleGrain = () => (grainMode.value = !grainMode.value);

  // The GitHub PRs referenced across notes.
  // Remembered where it's docked; a phone, or a popup, opens with nothing over the canvas.
  const prsDocked = persistedFlag("dagobert.prs", false);
  let showPRs = $state(!isMobile && !layout.popups.includes("prs") && prsDocked.value);
  function togglePRs() {
    showPRs = !showPRs;
    if (isMobile) {
      if (showPRs) store.sheetFull = true;
      return;
    }
    prsDocked.value = showPRs;
  }

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
  let showGallery = $state(false);
  let showCalendar = $state(false);
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
  /** Bumped per opening, so an already open settings pane goes to the page asked for. */
  let settingsKey = $state(0);

  function openSettings(section: typeof settingsSection, workflow?: string | null) {
    settingsSection = section;
    settingsWorkflow = workflow;
    showWorkflows = true;
    settingsKey++;
  }
  store.openSettings = openSettings;

  function hidePanels() {
    showWorkflows = false;
    showTrash = false;
    showGallery = false;
    showCalendar = false;
    showPRs = false;
  }

  $effect(() => {
    if (isMobile && (showWorkflows || showTrash || showGallery || showCalendar)) store.sheetFull = true;
  });

  /** The phone shows exactly one panel; this is which. */
  const mobilePanel = $derived(
    !isMobile || !store.path
      ? null
      : showWorkflows
        ? "settings"
        : showTrash
          ? "trash"
          : showGallery
            ? "gallery"
            : showCalendar
              ? "calendar"
              : showPRs
                ? "prs"
                : store.selected
                  ? "note"
                  : null,
  );
  let sheet = $state<Sheet | null>(null);
  /** Canvas taps ask the panel to leave, so it animates out. */
  store.dismissPanel = () => sheet?.dismiss();

  /** Dismissing is dismissing: there is no stack to pop back to. */
  function closePanel() {
    hidePanels();
    store.select(null);
  }

  const isOpen: Record<Pane, () => boolean> = {
    note: () => !!store.selected,
    prs: () => showPRs,
    trash: () => showTrash,
    settings: () => showWorkflows,
    gallery: () => showGallery,
    calendar: () => showCalendar,
  };
  const close: Record<Pane, () => void> = {
    note: () => store.select(null),
    prs: togglePRs,
    trash: () => (showTrash = false),
    settings: () => (showWorkflows = false),
    gallery: () => (showGallery = false),
    calendar: () => (showCalendar = false),
  };
  /** The desktop's open panels, each in a `Dock`. */
  const openPanes = $derived(isMobile || !store.path ? [] : PANES.filter((p) => isOpen[p]()));

  /** The graph stays put on screen when panels open, close or resize around it. */
  function shift(dx: number, dy: number) {
    store.viewport.x -= dx;
    store.viewport.y -= dy;
    store.saveViewport();
  }

  function restored(id: string) {
    if (layout.popups.includes("trash")) showTrash = false;
    jump(id);
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
          const hay = `${n.title} ${n.tags.map((t) => "#" + t).join(" ")} ${stripMedia(stripMarkers(n.body), true)}`.toLowerCase();
          return terms.every((t) => hay.includes(t));
        })
        .map((n) => n.id),
    );
  });

  const stats = $derived({
    total: store.notes.filter((n) => !n.permanent).length,
    done: store.notes.filter((n) => store.isDone(n)).length,
    ready: store.notes.filter((n) => store.isReady(n)).length,
    overdue: store.notes.filter((n) => dueState(n.due, store.isDone(n), clock.now) === "overdue").length,
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

  /** From the calendar: a new note due that day, in the middle of the view. */
  function createDue(due: string) {
    const c = viewCenter();
    const n = store.create(Math.round(c.x), Math.round(c.y), { due });
    jump(n.id);
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
          enabled: !!sel && !sel.tracking && !sel.permanent,
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
      a("insert-media", t("action.insert-media"), () => insertMedia(), {
        icon: ImageSquare,
        symbol: ["photo.on.rectangle", "photo"],
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
      a("due-today", t("action.due-today"), () => store.selectedId && store.setDue(store.selectedId, clock.today), {
        icon: CalendarCheck,
        symbol: ["calendar.badge.clock", "calendar"],
        menu: "Note",
        enabled: !!sel,
      }),
      a("due-clear", t("action.due-clear"), () => store.selectedId && store.setDue(store.selectedId, null), {
        icon: CalendarMinus,
        symbol: ["calendar.badge.minus", "calendar"],
        menu: "Note",
        enabled: !!sel?.due,
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
      a("gallery", t(showGallery ? "action.gallery.hide" : "action.gallery.show"), () => (showGallery = !showGallery), {
        icon: Images,
        symbol: ["photo.on.rectangle.angled", "photo"],
        menu: "View",
        menuLabel: t("action.gallery.menu"),
        enabled: has,
      }),
      a("calendar", t(showCalendar ? "action.calendar.hide" : "action.calendar.show"), () => (showCalendar = !showCalendar), {
        hint: keys.calendar,
        icon: CalendarBlank,
        symbol: ["calendar"],
        menu: "View",
        menuLabel: t("action.calendar.menu"),
        enabled: has,
      }),
      a(
        "update",
        updater.ready ? t("action.update.install", { version: readyVersion() ?? "" }) : t("action.update.check"),
        () => (updater.ready ? install() : checkNow()),
        { icon: ArrowCircleUp, symbol: ["arrow.down.circle"], menu: "App" },
      ),
      a("settings", t("action.settings"), () => (showWorkflows ? (showWorkflows = false) : openSettings("github")), {
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

  /** Undo/redo from the menu: native inside text fields (not the palette's search), ours elsewhere. */
  function editUndo(kind: "undo" | "redo") {
    const el = document.activeElement as HTMLElement | null;
    if (el && el.closest("input, textarea, [contenteditable]") && !el.closest("[role=combobox]")) document.execCommand(kind);
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
  const WINDOW_KEYS = ["new-note", "commands", "quick-open", "prs", "calendar", "search", "open-folder", "git-sync", "settings"] as const;
  function onKey(e: KeyboardEvent) {
    if (standaloneId) return;
    const id = WINDOW_KEYS.find((k) => pressed(keys[k], e));
    if (!id) return;
    const action = paletteActions.find((a) => a.id === id);
    if (!action || action.enabled === false) return;
    e.preventDefault();
    action.run();
  }

  /** Picks media for the selected note; its editor puts them at the caret, else they're appended. */
  async function insertMedia() {
    const id = store.selectedId;
    const embeds = id ? await store.pickMedia() : [];
    if (!id || !embeds.length) return;
    if (window.dispatchEvent(new CustomEvent("insert-media", { detail: { id, embeds }, cancelable: true }))) store.appendBlocks(id, embeds);
  }

  onMount(() => {
    const unsub = backend.subscribe((m) => store.applySync(m));
    // The editor or the canvas under the pointer takes dropped files (see `media-drop` listeners).
    const undrop = backend.onFileDrop((items, x, y) =>
      document.elementFromPoint(x, y)?.dispatchEvent(new CustomEvent<MediaDrop>("media-drop", { bubbles: true, detail: { items, x, y } })),
    );
    const unwatch = backend.onProjectChanged((c) => store.applyExternal(c));
    const ungit = standaloneId ? () => {} : backend.onGitEvent((kind, reason) => (kind === "tick" ? store.tick() : store.quitSync(reason)));
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
    const onFocus = () => store.focused();
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsub();
      undrop();
      unwatch();
      ungit();
      unupdate();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
</script>

{#snippet pane(p: Pane)}
  {#if p === "note" && store.selected}
    {#key store.selected.id}
      <NotePanel note={store.selected} onjump={jump} />
    {/key}
  {:else if p === "prs"}
    {#await import("./lib/PullRequests.svelte") then m}
      <m.default onclose={togglePRs} onjump={jump} />
    {/await}
  {:else if p === "trash"}
    {#await import("./lib/TrashDialog.svelte") then m}
      <m.default onclose={() => (showTrash = false)} onrestored={restored} />
    {/await}
  {:else if p === "gallery"}
    {#await import("./lib/Gallery.svelte") then m}
      <m.default onclose={() => (showGallery = false)} />
    {/await}
  {:else if p === "calendar"}
    {#await import("./lib/Calendar.svelte") then m}
      <m.default onclose={() => (showCalendar = false)} onjump={jump} oncreate={createDue} />
    {/await}
  {:else if p === "settings"}
    {#key settingsKey}
      {#await import("./lib/WorkflowEditor.svelte") then m}
        <m.default section={settingsSection} workflow={settingsWorkflow} onclose={() => (showWorkflows = false)} />
      {/await}
    {/key}
  {/if}
{/snippet}

{#if standaloneId}
  <div class="standalone">
    {#if store.selected}
      {#key store.selected.id}
        <NotePanel note={store.selected} onjump={(id) => store.select(id)} standalone />
      {/key}
    {:else if store.path}
      <div class="gone">{t("standalone.gone")}</div>
    {/if}
    {#if showWorkflows}
      <Dock pane="settings" onclose={() => (showWorkflows = false)}>{@render pane("settings")}</Dock>
    {/if}
  </div>
{:else if store.path}
  <div class="app">
    <div class="toolbar" data-tauri-drag-region={isMobile ? undefined : true}>
      <div class="brand" data-tauri-drag-region={isMobile ? undefined : true}>
        {#if isMobile}
          <!-- The mark is the way back to the project list; there is no menu to hold one. -->
          <button class="btn btn--ghost btn--icon btn--lg" onclick={() => store.close()} aria-label={t("toolbar.projects")}>
            <img class="mark" src="/icon.svg" alt="" draggable="false" />
          </button>
        {:else}
          <img class="mark" src="/icon.svg" alt="" draggable="false" />
          <span class="logo">{t("app.name")}</span>
          <span class="sep">/</span>
          <button class="btn btn--ghost project" onclick={() => store.close()} title={store.path}>{store.projectName}</button>
        {/if}
      </div>
      {#if !isMobile}
        <input
          class="field-input search"
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
        <button class="btn btn--ghost update" onclick={install} use:tooltip={t("toolbar.update.tip", { version: readyVersion() ?? "" })}
          ><ArrowCircleUp /> {t("toolbar.update")}</button
        >
      {/if}
      <span class="stats" class:hide={isMobile} title={t("toolbar.stats.title")}>
        <span class="counts"
          ><span class="ready">{t("toolbar.stats.ready", { n: stats.ready })}</span> · {t("toolbar.stats.done", {
            done: stats.done,
            total: stats.total,
          })}</span
        >
        {#if stats.overdue}
          <span class="dot">·</span>
          <button class="btn btn--link overdue" onclick={() => (showCalendar = true)} use:tooltip={t("toolbar.stats.overdue.tip")}
            >{t("toolbar.stats.overdue", { n: stats.overdue })}</button
          >
        {/if}
        {#if store.conflictIds.size}
          <span class="dot">·</span>
          <button class="btn btn--link conflicts" onclick={() => store.nextConflict()} use:tooltip={t("toolbar.conflicts.tip")}
            ><Warning weight="fill" /> {store.conflictIds.size}</button
          >
        {/if}
      </span>
      {#if store.gitEnabled}
        <IconButton
          label={t("toolbar.git.aria")}
          tip={gitTip}
          size="lg"
          class={["git", store.gitState, store.gitStatus && !store.gitStatus.has_remote && "local"]}
          onclick={() => store.syncNow(true)}
        >
          {#if store.gitState === "syncing"}<span class="spin"><ArrowsClockwise /></span>{:else}<GitBranch />{/if}
        </IconButton>
      {/if}
      <TagMenu />
      {#if isMobile}
        <IconButton label={t("minimap.toggle")} size="lg" pressed={minimap.open} onclick={toggleMinimap}><MapTrifold /></IconButton>
        <IconButton label={t("toolbar.more")} size="lg" onclick={() => openPalette("commands")}><Terminal /></IconButton>
      {:else}
        <IconButton label={t("toolbar.trash")} size="lg" class="opt" onclick={() => (showTrash = true)}><Trash /></IconButton>
        <IconButton
          label={t("toolbar.calendar")}
          shortcut={keys.calendar}
          size="lg"
          class="opt-narrow"
          pressed={showCalendar}
          onclick={() => (showCalendar = !showCalendar)}><CalendarBlank /></IconButton
        >
        <IconButton
          label={t("toolbar.prs")}
          tip={{ text: t("toolbar.prs.tip"), hint: keys.prs }}
          size="lg"
          class="opt-narrow"
          pressed={showPRs}
          onclick={togglePRs}><GitPullRequest /></IconButton
        >
        <IconButton label={t("toolbar.focus")} tip={t("toolbar.focus.tip")} size="lg" class="opt" pressed={focus} onclick={toggleFocus}
          ><Crosshair /></IconButton
        >
        <IconButton label={t("toolbar.tidy")} tip={t("toolbar.tidy.tip")} size="lg" class="opt" onclick={() => canvas?.tidy()}
          ><TreeStructure /></IconButton
        >
        <IconButton label={t("toolbar.fit")} tip={t("toolbar.fit.tip")} size="lg" class="opt" onclick={() => canvas?.fitAll()}
          ><CornersOut /></IconButton
        >
        <!-- Stands in for the buttons a narrow window hides. -->
        <IconButton
          label={t("toolbar.more")}
          tip={{ text: t("toolbar.more"), hint: keys.commands }}
          size="lg"
          class="more"
          onclick={() => openPalette("commands")}><Terminal /></IconButton
        >
        <IconButton
          label={t("toolbar.new")}
          shortcut={keys["new-note"]}
          size="lg"
          variant="default"
          class="btn--primary"
          onclick={() => canvas?.createAtCenter()}><Plus weight="bold" /></IconButton
        >
      {/if}
    </div>
    <Tiles open={openPanes} {pane} onclose={(p) => close[p]()} onshift={shift}>
      <Canvas bind:this={canvas} {matches} {focus} {grain} />
    </Tiles>
    {#if isMobile}
      <!-- Rides above a peeking sheet, and gets out of the way of a full one. -->
      <div class="bottombar" class:tucked={!!mobilePanel && store.sheetFull}>
        <IconButton label={t("action.quick-open")} size="lg" onclick={() => openPalette("notes")}><MagnifyingGlass /></IconButton>
        <IconButton
          label={t("toolbar.new")}
          size="lg"
          variant="default"
          class="btn--primary create"
          onclick={() => canvas?.createAtCenter()}><Plus weight="bold" /></IconButton
        >
        <IconButton label={t("toolbar.prs")} size="lg" pressed={showPRs} onclick={togglePRs}><GitPullRequest /></IconButton>
      </div>
      {#if mobilePanel}
        <Sheet
          bind:this={sheet}
          bind:full={store.sheetFull}
          onclose={closePanel}
          label={t(PANE_LABEL[mobilePanel])}
          expandLabel={t("panel.sheet.expand")}
          collapseLabel={t("panel.sheet.collapse")}
        >
          {@render pane(mobilePanel)}
        </Sheet>
      {/if}
    {/if}
  </div>
{:else if store.restoring}
  <div class="welcome" data-tauri-drag-region={isMobile ? undefined : true}></div>
{:else}
  <div class="welcome" data-tauri-drag-region={isMobile ? undefined : true}>
    <div class="card">
      <img class="hero" src="/logo.svg" alt="" draggable="false" />
      <h1>{t("app.name")}</h1>
      <p class="tagline">{t("welcome.tagline")}</p>
      {#if isMobile}
        {#if auth.signedIn}
          <button class="btn btn--primary btn--lg" onclick={() => (showClone = true)}><CloudArrowDown /> {t("welcome.clone")}</button>
        {:else}
          <p class="hint">{t("welcome.signin.help")}</p>
        {/if}
        <GitHubSignIn compact />
        <h3>{t("welcome.projects")}</h3>
        {#if projects.length}
          <ul class="recent">
            {#each projects as p (p.name)}
              <li>
                <button class="path hoverable" onclick={() => store.open(p.path)}><span class="name">{p.name}</span></button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="hint">{t("welcome.noProjects")}</p>
        {/if}
      {:else}
        <button class="btn btn--primary btn--lg" onclick={() => store.pickAndOpen()}>{t("welcome.open")}</button>
        <p class="hint">{t("welcome.hint")}</p>
        {#if store.recent.length}
          <h3>{t("welcome.recent")}</h3>
          <ul class="recent">
            {#each store.recent as r (r)}
              <li>
                <button class="path hoverable" onclick={() => store.openRef(r)} title={r}>
                  <span class="name">{nameOf(r)}</span>
                  <span class="full">{r}</span>
                </button>
                <IconButton label={t("welcome.forget")} tip={false} onclick={() => store.forgetRecent(r)}><X /></IconButton>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if showClone}
  {#await import("./lib/CloneDialog.svelte") then m}
    <m.default onclose={() => (showClone = false)} />
  {/await}
{/if}

{#if showQuickOpen}
  {#key paletteMode}
    {#await import("./lib/QuickOpen.svelte") then m}
      <m.default
        mode={paletteMode}
        actions={paletteActions}
        onjump={jump}
        oncreate={createTitled}
        onclose={() => (showQuickOpen = false)}
      />
    {/await}
  {/key}
{/if}

{#if store.needsRepo}
  {#await import("./lib/GitDialog.svelte") then m}
    <m.default kind="norepo" onclose={() => (store.needsRepo = false)} />
  {/await}
{:else if store.conflictReport}
  {#await import("./lib/GitDialog.svelte") then m}
    <m.default kind="conflicts" conflicts={store.conflictReport} onclose={() => (store.conflictReport = null)} />
  {/await}
{/if}

<ToastHost dismissLabel={t("app.dismiss")} />
<ContextMenuHost label={t("ctx.label")} dismissLabel={t("app.dismiss")} />

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
    gap: var(--gap-4);
    padding: 0 var(--sp-5) 0 84px; /* room for macOS traffic lights */
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    margin-right: var(--gap-4);
  }
  .mark {
    width: var(--mark);
    height: var(--mark);
    opacity: 0.9;
  }
  .logo {
    font-weight: 700;
    color: var(--color2);
    background: linear-gradient(90deg, var(--theme2), color-mix(in srgb, var(--theme2) 55%, var(--color2)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .sep {
    color: var(--faint);
  }
  .project {
    padding: var(--gap-1) var(--gap-3);
    font-weight: inherit;
    color: var(--color);
  }
  .search {
    width: 260px;
    min-width: 96px;
    flex: 0 1 auto;
    padding: var(--sp-1) var(--sp-4);
    border-radius: var(--radius-pill);
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .spacer {
    flex: 1;
  }
  .stats.hide {
    display: none;
  }
  .stats {
    display: flex;
    align-items: center;
    font-size: var(--fs-xs);
    color: var(--muted);
    white-space: nowrap;
    margin-right: var(--gap-2);
  }
  .stats .dot {
    margin: 0 0.3em;
  }
  .toolbar :global(.more) {
    display: none;
  }
  /* A narrow window drops what the command palette also reaches, least used first. */
  @media (max-width: 940px) {
    .stats .counts {
      display: none;
    }
    .stats .counts + .dot {
      display: none;
    }
  }
  @media (max-width: 900px) {
    .logo,
    .sep {
      display: none;
    }
    .toolbar :global(.opt) {
      display: none;
    }
    .toolbar :global(.more) {
      display: inline-flex;
    }
  }
  @media (max-width: 620px) {
    .toolbar :global(.opt-narrow) {
      display: none;
    }
  }
  .stats .ready {
    color: var(--theme2);
  }
  .update {
    font-size: var(--fs-xs);
    color: var(--theme2);
  }
  .overdue {
    font-size: var(--fs-xs);
    color: var(--danger);
  }
  .conflicts {
    gap: var(--gap-1);
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  .toolbar :global(.git.local) {
    color: var(--muted);
  }
  .toolbar :global(.git.error) {
    color: var(--danger);
  }
  .toolbar :global(.git.syncing) {
    color: var(--theme2);
  }

  /* Floats over the canvas rather than taking a strip of it. */
  .bottombar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(var(--gap-4) + var(--safe-bottom));
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
      opacity var(--dur-slow) var(--ease);
  }
  :global(body.sheet-dragging) .bottombar {
    transition: none;
  }
  .bottombar.tucked :global(.btn) {
    pointer-events: none;
  }
  .bottombar :global(.btn) {
    pointer-events: auto;
    border-radius: var(--radius-pill);
    box-shadow: var(--shadow-lg);
  }
  .bottombar :global(.btn--ghost) {
    background: var(--bg2);
  }
  .bottombar :global(.create) {
    width: 56px;
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
    color: var(--muted);
  }

  .welcome {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      radial-gradient(ellipse at 20% 0%, var(--theme-soft), transparent 60%),
      radial-gradient(ellipse at 80% 100%, color-mix(in srgb, var(--theme) 9%, transparent), transparent 60%), var(--bg);
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
    width: 380px;
    padding: 32px;
    background: var(--bg2);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    text-align: center;
  }
  .hero {
    width: 96px;
    height: 96px;
    margin: -8px auto 12px;
    display: block;
    filter: drop-shadow(0 8px 24px var(--theme-mid));
  }
  .card h1 {
    margin: 0;
    font-size: 32px;
    color: var(--color2);
    background: linear-gradient(90deg, var(--theme2), color-mix(in srgb, var(--theme2) 55%, var(--color2)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .tagline {
    margin: 4px 0 24px;
    color: var(--muted);
  }
  .card .hint {
    margin: var(--sp-5) 0 0;
  }
  .card h3 {
    margin: 28px 0 var(--gap-4);
    font-size: var(--fs-micro);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
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
    padding: var(--sp-2) var(--sp-4);
    border-radius: var(--radius);
    color: var(--color);
  }
  .path .name {
    color: var(--color2);
  }
  .path .full {
    font-size: var(--fs-micro);
    color: var(--faint);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
  }
</style>
