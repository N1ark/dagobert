<script lang="ts" module>
  export type MenuTarget =
    | { kind: "node"; id: string }
    | { kind: "group"; ids: string[] }
    | { kind: "edge"; from: string; to: string }
    | { kind: "background"; wx: number; wy: number };

  export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hspread" | "vspread";
</script>

<script lang="ts">
  import { menu, tooltip, type MaybeEntry, type MenuControl } from "purr";
  import {
    AlignBottom,
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignLeft,
    AlignRight,
    AlignTop,
    ArrowSquareOut,
    Copy,
    DistributeHorizontal,
    DistributeVertical,
    FolderOpen,
    Trash,
  } from "purr/icons";
  import { store } from "./store.svelte";
  import { isMobile } from "./backend";
  import { stageColor } from "./workflows";
  import { t } from "./i18n";
  import { keys } from "./keys";
  import type { Note } from "./types";

  /** The canvas's menu, for a note, a selection, a link or the background; renders nothing of its own. */
  let {
    oncreate,
    onpaste,
    onalign,
  }: {
    oncreate: (wx: number, wy: number) => void;
    onpaste: (wx: number, wy: number) => void;
    onalign: (ids: string[], how: Align) => void;
  } = $props();

  const ALIGNS = [
    ["left", AlignLeft, "ctx.align.left"],
    ["hcenter", AlignCenterHorizontal, "ctx.align.hcenter"],
    ["right", AlignRight, "ctx.align.right"],
    ["top", AlignTop, "ctx.align.top"],
    ["vcenter", AlignCenterVertical, "ctx.align.vcenter"],
    ["bottom", AlignBottom, "ctx.align.bottom"],
    ["hspread", DistributeHorizontal, "ctx.align.hspread"],
    ["vspread", DistributeVertical, "ctx.align.vspread"],
  ] as const;

  let target = $state.raw<MenuTarget | null>(null);
  let newTag = $state("");

  const notesOf = (ids: string[]) => ids.map((id) => store.byId(id)).filter((n): n is Note => !!n);

  export function show(x: number, y: number, at: MenuTarget) {
    target = at;
    newTag = "";
    menu.showAt(x, y, () => build(at));
  }

  /** Re-read while open, so the tag checks follow what was just toggled. */
  function build(at: MenuTarget): MaybeEntry[] {
    if (at.kind === "node") return nodeEntries(at.id);
    if (at.kind === "group") return groupEntries(notesOf(at.ids), at.ids);
    if (at.kind === "edge")
      return [
        { kind: "heading", label: t("ctx.edge", { from: titleOf(at.from), to: titleOf(at.to) }) },
        { label: t("ctx.removeLink"), danger: true, run: () => store.removeDependency(at.to, at.from) },
      ];
    return [
      { label: t("ctx.newHere"), run: () => oncreate(at.wx, at.wy) },
      { label: t("ctx.paste"), hint: keys.paste, disabled: !store.clipboard, run: () => onpaste(at.wx, at.wy) },
    ];
  }

  const titleOf = (id: string) => store.byId(id)?.title || t("app.untitled");

  function nodeEntries(id: string): MaybeEntry[] {
    const note = store.byId(id);
    if (!note) return [];
    const workflow = store.workflowOf(note);
    const progress = note.tracking ? store.progress(note) : null;
    return [
      { label: t("ctx.open"), run: () => store.select(id) },
      { label: t("ctx.openWindow"), icon: ArrowSquareOut, run: () => store.openInWindow(id) },
      !isMobile && { label: t("ctx.reveal"), icon: FolderOpen, run: () => store.revealInFinder(id) },
      { label: t("ctx.copy"), icon: Copy, hint: keys.copy, run: () => store.copy(id) },
      {
        label: t("ctx.duplicate"),
        hint: keys.duplicate,
        run: () => {
          const d = store.duplicate(id);
          if (d) store.select(d.id);
        },
      },
      progress
        ? { kind: "heading", label: t("ctx.tracking", { done: progress.done, total: progress.total }) }
        : note.workflow === null
          ? { label: t(store.isDone(note) ? "node.markNotDone" : "node.markDone"), run: () => store.advance(id) }
          : null,
      !progress && note.workflow !== null && { kind: "heading", label: t("ctx.status") },
      ...(!progress && note.workflow !== null
        ? workflow.stages.map((stage) => ({
            label: stage.name,
            swatch: stageColor(workflow, stage.name),
            checked: note.status === stage.name,
            run: () => store.setStatus(id, stage.name),
          }))
        : []),
      ...tagEntries(
        (tag) => note.tags.includes(tag),
        (tag) => store.toggleTag(id, tag),
      ),
      { kind: "custom", render: tagInput },
      note.width != null && { label: t("ctx.resetWidth"), run: () => store.setWidth(id, null) },
      "separator",
      { label: t("ctx.delete"), icon: Trash, danger: true, confirm: t("ctx.reallyDelete"), run: () => store.remove(id) },
    ];
  }

  function groupEntries(group: Note[], ids: string[]): MaybeEntry[] {
    const has = (tag: string) => {
      const c = group.filter((n) => n.tags.includes(tag)).length;
      return c === group.length ? true : c ? ("mixed" as const) : false;
    };
    return [
      { kind: "heading", label: t("ctx.group.selected", { n: group.length }) },
      { label: t("ctx.group.allDone"), run: () => group.forEach((n) => store.setDone(n.id, true)) },
      { label: t("ctx.group.allNotDone"), run: () => group.forEach((n) => store.setDone(n.id, false)) },
      { kind: "custom", render: aligns },
      ...tagEntries(has, (tag) => {
        const all = has(tag) === true;
        for (const n of group) (all ? store.removeTag : store.addTag).call(store, n.id, tag);
      }),
      { kind: "custom", render: tagInput },
      "separator",
      {
        label: t("ctx.group.delete", { n: group.length }),
        icon: Trash,
        danger: true,
        confirm: t("ctx.group.reallyDelete", { n: group.length }),
        run: () => ids.forEach((n) => store.remove(n)),
      },
    ];
  }

  function tagEntries(has: (tag: string) => boolean | "mixed", toggle: (tag: string) => void): MaybeEntry[] {
    return [
      { kind: "heading", label: t("ctx.tags") },
      ...store.allTags.map(({ tag }) => ({
        label: tag,
        swatch: store.tagColor(tag),
        checked: has(tag),
        keepOpen: true,
        run: () => toggle(tag),
      })),
    ];
  }

  function addTag() {
    const tag = newTag.trim();
    const ids = target?.kind === "node" ? [target.id] : target?.kind === "group" ? target.ids : [];
    if (!tag) return;
    for (const id of ids) store.addTag(id, tag);
    newTag = "";
  }
</script>

{#snippet tagInput(_: MenuControl)}
  <form
    class="new-tag"
    onsubmit={(e) => {
      e.preventDefault();
      addTag();
    }}
  >
    <input
      class="field-input"
      placeholder={t(target?.kind === "group" ? "ctx.group.addTag" : "ctx.newTag")}
      bind:value={newTag}
      onblur={addTag}
    />
  </form>
{/snippet}

{#snippet aligns(control: MenuControl)}
  {@const count = target?.kind === "group" ? target.ids.length : 0}
  <div class="aligns">
    {#each ALIGNS as [how, Icon, label], i (how)}
      {#if i === 3 || i === 6}<span class="vsep"></span>{/if}
      <button
        type="button"
        class="btn btn--ghost btn--icon btn--lg"
        role="menuitem"
        aria-label={t(label)}
        use:tooltip={t(label)}
        disabled={i >= 6 && count < 3}
        aria-disabled={i >= 6 && count < 3}
        onclick={() => {
          control.close();
          if (target?.kind === "group") onalign(target.ids, how);
        }}><Icon /></button
      >
    {/each}
  </div>
{/snippet}

<style>
  .new-tag {
    padding: var(--gap-1) var(--gap-2) var(--gap-2);
  }
  .new-tag input {
    min-height: 0;
    padding: var(--gap-1) var(--gap-4);
    font-size: var(--fs-xs);
  }
  .aligns {
    display: flex;
    align-items: center;
    padding: var(--gap-1) 0;
  }
  .vsep {
    width: 1px;
    height: 16px;
    margin: 0 var(--gap-2);
    background: var(--border);
  }
</style>
