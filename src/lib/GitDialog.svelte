<script lang="ts">
  import { Modal, PanelHeader } from "purr";
  import { Warning, Check, GitBranch } from "purr/icons";
  import { store } from "./store.svelte";
  import type { Conflict } from "./types";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  /** "norepo": offer to create a repository; "conflicts": what the last pull merged. */
  let { kind, conflicts = [], onclose }: { kind: "norepo" | "conflicts"; conflicts?: Conflict[]; onclose: () => void } = $props();

  function jump(id: string) {
    onclose();
    store.jump(id);
  }
</script>

<Modal label={t("git.aria")} {onclose} width="480px" closeLabel={t("git.close")}>
  <PanelHeader
    title={t(kind === "norepo" ? "git.title" : "git.conflicts.title")}
    icon={kind === "norepo" ? GitBranch : Warning}
    {onclose}
    closeLabel={t("git.close")}
  />
  {#if kind === "norepo"}
    <div class="body">
      <p>{t("git.norepo")}</p>
      <p class="help"><InlineMd source={t("git.norepo.help")} /></p>
    </div>
  {:else}
    <div class="body">
      <p class="help"><InlineMd source={t("git.conflicts.help")} /></p>
      <ul>
        {#each conflicts as c (c.id)}
          <li>
            <button class="title" onclick={() => jump(c.id)}><InlineMd source={c.title} fallback={t("app.untitled")} /></button>
            {#if c.body_conflict}
              <span class="hint attention"><Warning /> {t("git.conflicts.attention")}</span>
            {:else}
              <span class="hint"><Check /> {t("git.conflicts.merged")}</span>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#snippet footer()}
    {#if kind === "norepo"}
      <button class="btn btn--ghost" onclick={onclose}>{t("git.norepo.cancel")}</button>
      <button class="btn btn--primary" onclick={() => store.initRepo().then(onclose)}>{t("git.norepo.init")}</button>
    {:else}
      <button class="btn btn--primary" onclick={onclose}>{t("git.conflicts.ok")}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .body {
    padding: var(--sp-4) var(--sp-5);
    max-height: 60vh;
    overflow: auto;
  }
  .body p {
    margin: 0 0 var(--gap-4);
  }
  .help {
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .body :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 1px var(--gap-2);
    border-radius: var(--radius-sm);
  }
  ul {
    list-style: none;
    margin: var(--gap-4) 0 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: var(--gap-4);
    padding: var(--gap-1) 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    color: var(--color2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .title:hover {
      color: var(--theme2);
    }
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    font-size: var(--fs-micro);
    color: var(--muted);
    white-space: nowrap;
  }
  .hint.attention {
    color: var(--warn);
  }
</style>
