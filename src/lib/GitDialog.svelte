<script lang="ts">
  import { store } from "./store.svelte";
  import type { Conflict } from "./types";
  import InlineMd from "./InlineMd.svelte";
  import X from "phosphor-svelte/lib/X";
  import Warning from "phosphor-svelte/lib/Warning";
  import Check from "phosphor-svelte/lib/Check";
  import GitBranch from "phosphor-svelte/lib/GitBranch";
  import { t } from "./i18n";

  /** "norepo": offer to create a repository; "conflicts": what the last pull merged. */
  let { kind, conflicts = [], onclose }: { kind: "norepo" | "conflicts"; conflicts?: Conflict[]; onclose: () => void } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
  function jump(id: string) {
    onclose();
    store.jump(id);
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={t("git.aria")} tabindex="-1">
    <header>
      <h3>
        {#if kind === "norepo"}<GitBranch size={15} /> {t("git.title")}{:else}<Warning size={15} /> {t("git.conflicts.title")}{/if}
      </h3>
      <button class="ghost" onclick={onclose} aria-label={t("git.close")}><X size={16} /></button>
    </header>
    {#if kind === "norepo"}
      <div class="body">
        <p>{t("git.norepo")}</p>
        <p class="help"><InlineMd source={t("git.norepo.help")} /></p>
      </div>
      <footer>
        <button class="ghost" onclick={onclose}>{t("git.norepo.cancel")}</button>
        <button class="primary" onclick={() => store.initRepo().then(onclose)}>{t("git.norepo.init")}</button>
      </footer>
    {:else}
      <div class="body">
        <p class="help"><InlineMd source={t("git.conflicts.help")} /></p>
        <ul>
          {#each conflicts as c (c.id)}
            <li>
              <button class="ghost title" onclick={() => jump(c.id)}><InlineMd source={c.title} fallback={t("app.untitled")} /></button>
              {#if c.body_conflict}
                <span class="hint attention"><Warning size={12} /> {t("git.conflicts.attention")}</span>
              {:else}
                <span class="hint"><Check size={12} /> {t("git.conflicts.merged")}</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
      <footer>
        <button class="primary" onclick={onclose}>{t("git.conflicts.ok")}</button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #00000088;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    width: 480px;
    max-width: calc(100vw - 40px);
    background: var(--bg2);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 14px;
    color: var(--color2);
  }
  .body {
    padding: 12px 16px;
    max-height: 60vh;
    overflow: auto;
  }
  .body p {
    margin: 0 0 8px;
  }
  .help {
    font-size: 12px;
    color: var(--color-dim);
  }
  .dialog :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 3px;
  }
  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    text-align: left;
    color: var(--color2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-dim);
    white-space: nowrap;
  }
  .hint.attention {
    color: var(--yellow);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
  }
</style>
