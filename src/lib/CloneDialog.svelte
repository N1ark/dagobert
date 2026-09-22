<script lang="ts">
  import { backend } from "./backend";
  import { auth } from "./auth.svelte";
  import { store } from "./store.svelte";
  import X from "phosphor-svelte/lib/X";
  import CloudArrowDown from "phosphor-svelte/lib/CloudArrowDown";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  let { onclose }: { onclose: () => void } = $props();

  let url = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function clone() {
    if (!url.trim() || busy) return;
    busy = true;
    error = null;
    try {
      const s = auth.session;
      const p = await backend.cloneProject(url.trim(), await auth.token(), s?.name ?? "", s?.email ?? "");
      onclose();
      await store.open(p.path);
    } catch (e) {
      error = typeof e === "string" ? e : ((e as Error)?.message ?? String(e));
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label={t("clone.aria")} tabindex="-1">
    <header>
      <h3><CloudArrowDown size={15} /> {t("clone.title")}</h3>
      <button class="ghost" onclick={onclose} aria-label={t("clone.close")}><X size={16} /></button>
    </header>
    <form
      class="body"
      onsubmit={(e) => {
        e.preventDefault();
        clone();
      }}
    >
      <label>
        {t("clone.url")}
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={url} placeholder={t("clone.url.placeholder")} spellcheck="false" autocapitalize="off" autofocus />
      </label>
      <p class="help"><InlineMd source={t("clone.help")} /></p>
      {#if !auth.signedIn}
        <p class="err">{t("clone.signin")}</p>
      {/if}
      {#if error}<p class="err">{error}</p>{/if}
      <footer>
        <button type="button" class="ghost" onclick={onclose}>{t("clone.cancel")}</button>
        <button type="submit" class="primary" disabled={!url.trim() || busy || !auth.signedIn}
          >{t(busy ? "clone.cloning" : "clone.go")}</button
        >
      </footer>
    </form>
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
    width: 460px;
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
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--color-dim);
  }
  input {
    width: 100%;
    font-size: 14px;
  }
  .help {
    margin: -4px 0 0;
    font-size: 12px;
    color: var(--color-dim);
  }
  .help :global(code) {
    font-family: var(--mono);
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .err {
    margin: 0;
    font-size: 12px;
    color: var(--red);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
</style>
