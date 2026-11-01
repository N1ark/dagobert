<script lang="ts">
  import { Highlight, onEscape, rank } from "purr";
  import { store } from "./store.svelte";
  import { t } from "./i18n";

  let {
    value = $bindable(""),
    exclude = [],
    placeholder,
    inline = false,
    onadd,
    onbackspace,
  }: {
    value?: string;
    /** Tags the note already has, left out of the suggestions. */
    exclude?: string[];
    placeholder: string;
    /** The list flows under the field instead of floating (inside a menu, which would clip it). */
    inline?: boolean;
    onadd: (tag: string) => void;
    /** Backspace in the empty field. */
    onbackspace?: () => void;
  } = $props();

  const uid = $props.id();
  let open = $state(false);
  let active = $state(-1);

  type Row = { tag: string; count: number; indices: readonly number[]; create?: boolean };

  const query = $derived(value.trim().replace(/^#/, ""));
  const rows = $derived.by<Row[]>(() => {
    const hits = rank(
      store.allTags.filter((x) => !exclude.includes(x.tag)),
      query,
      { keys: [(x) => x.tag], limit: 8 },
    ).map((r) => ({ ...r.item, indices: r.indices }));
    const q = query.toLowerCase();
    if (!q || store.allTags.some((x) => x.tag.toLowerCase() === q)) return hits;
    const create: Row = { tag: query, count: 0, indices: [], create: true };
    // A suggestion that starts with what was typed comes first; otherwise the new tag does.
    return hits[0]?.tag.toLowerCase().startsWith(q) ? [...hits, create] : [create, ...hits];
  });
  const shown = $derived(open && rows.length > 0);

  $effect(() => {
    void query;
    active = query ? 0 : -1;
  });

  function add(tag: string) {
    onadd(tag);
    value = "";
  }

  function onkeydown(e: KeyboardEvent) {
    if (shown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + rows.length + (active < 0 && step < 0 ? 1 : 0)) % rows.length;
    } else if ((e.key === "Enter" || e.key === "Tab") && shown && rows[active]) {
      e.preventDefault();
      e.stopPropagation();
      add(rows[active].tag);
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (value.trim()) add(value);
    } else if (e.key === "Backspace" && !value) {
      onbackspace?.();
    } else if (shown && e.key === "Escape") {
      onEscape(e, () => (open = false));
    }
  }
</script>

<span class="tag-input" class:inline>
  <input
    class:field-input={inline}
    bind:value
    {placeholder}
    spellcheck="false"
    autocomplete="off"
    role="combobox"
    aria-expanded={shown}
    aria-controls="{uid}-list"
    aria-activedescendant={shown && active >= 0 ? `${uid}-${active}` : undefined}
    aria-autocomplete="list"
    onfocus={() => (open = true)}
    oninput={() => (open = true)}
    onblur={() => {
      open = false;
      if (value.trim()) add(value);
    }}
    {onkeydown}
  />
  {#if shown}
    <ul class="list" class:surface={!inline} role="listbox" id="{uid}-list">
      {#each rows as row, i (row.create ? "\0" : row.tag)}
        <li role="option" id="{uid}-{i}" aria-selected={i === active}>
          <button
            type="button"
            class="row-item"
            class:is-cursor={i === active}
            tabindex="-1"
            onmousedown={(e) => e.preventDefault()}
            onclick={() => add(row.tag)}
            onmouseenter={() => (active = i)}
          >
            {#if row.create}
              <span class="create truncate">{t("tags.create", { tag: row.tag })}</span>
            {:else}
              <span class="tag" style:--tag={store.tagColor(row.tag)}
                ><span class="truncate"><Highlight text={row.tag} indices={row.indices} /></span></span
              >
              <span class="count">{row.count}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</span>

<style>
  .tag-input {
    position: relative;
    display: inline-flex;
    flex-direction: column;
  }
  .inline {
    display: flex;
  }
  input {
    min-height: 0;
    padding: var(--gap-1) var(--gap-2);
    font-size: var(--fs-xs);
  }
  .tag-input:not(.inline) input {
    width: 90px;
  }
  .inline input {
    padding: var(--gap-1) var(--gap-4);
  }
  .list {
    margin: 0;
    padding: var(--gap-2);
    list-style: none;
    max-height: 240px;
    overflow-y: auto;
  }
  .tag-input:not(.inline) .list {
    position: absolute;
    z-index: var(--z-popover);
    left: 0;
    top: calc(100% + var(--gap-2));
    min-width: 180px;
    box-shadow: var(--shadow-lg);
  }
  .inline .list {
    padding: var(--gap-2) 0 0;
  }
  .row-item {
    justify-content: space-between;
    width: 100%;
  }
  .count {
    flex: none;
    font-size: var(--fs-micro);
    color: var(--muted);
  }
  .create {
    color: var(--theme2);
    font-size: var(--fs-sm);
  }
  /* The match keeps the tag's own colour, just bolder. */
  .tag :global(mark) {
    color: inherit;
    font-weight: 700;
  }
</style>
