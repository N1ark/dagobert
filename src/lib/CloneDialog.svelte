<script lang="ts">
  import { backend } from "./backend";
  import { secrets } from "./secrets";
  import { store } from "./store.svelte";
  import X from "phosphor-svelte/lib/X";
  import CloudArrowDown from "phosphor-svelte/lib/CloudArrowDown";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  let { onclose }: { onclose: () => void } = $props();

  let url = $state("");
  let token = $state(secrets.gitToken());
  let name = $state(secrets.gitName());
  let email = $state(secrets.gitEmail());
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function clone() {
    if (!url.trim() || busy) return;
    busy = true;
    error = null;
    secrets.setGitToken(token);
    secrets.setGitName(name);
    secrets.setGitEmail(email);
    try {
      const p = await backend.cloneProject(url.trim());
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
      <label>
        {t("clone.token")}
        <input class="mono" type="password" bind:value={token} placeholder={t("settings.git.token.placeholder")} spellcheck="false" />
      </label>
      <div class="identity">
        <label>{t("clone.name")}<input bind:value={name} spellcheck="false" /></label>
        <label>{t("clone.email")}<input type="email" bind:value={email} spellcheck="false" autocapitalize="off" /></label>
      </div>
      {#if error}<p class="err">{error}</p>{/if}
      <footer>
        <button type="button" class="ghost" onclick={onclose}>{t("clone.cancel")}</button>
        <button type="submit" class="primary" disabled={!url.trim() || busy}>{t(busy ? "clone.cloning" : "clone.go")}</button>
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
  .mono {
    font-family: var(--mono);
    font-size: 12px;
  }
  .identity {
    display: flex;
    gap: 8px;
  }
  .identity label {
    flex: 1;
    min-width: 0;
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
