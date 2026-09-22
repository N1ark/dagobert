<script lang="ts">
  import { auth } from "./auth.svelte";
  import { backend } from "./backend";
  import GithubLogo from "phosphor-svelte/lib/GithubLogo";
  import { t } from "./i18n";

  /** Shown on the welcome screen as well as in settings, so it lives on its own. */
  let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="signin" class:compact>
  {#if auth.code}
    <p class="code-label">{t("settings.github.code")}</p>
    <p class="code">{auth.code}</p>
    <div class="actions">
      <span class="hint">{t("settings.github.waiting")}</span>
      <button onclick={() => auth.url && backend.openExternal(auth.url)}>{t("settings.github.reopen")}</button>
      <button class="ghost" onclick={() => auth.cancel()}>{t("settings.github.cancel")}</button>
    </div>
  {:else if auth.signedIn}
    <div class="actions">
      <span class="hint">{t("settings.github.signedInAs", { login: auth.session?.login ?? "" })}</span>
      <button class="ghost" onclick={() => auth.signOut()}>{t("settings.github.signout")}</button>
    </div>
  {:else}
    <div class="actions">
      <button class="primary" class:big={compact} disabled={auth.busy} onclick={() => auth.signIn()}
        ><GithubLogo size={16} /> {t("settings.github.signin")}</button
      >
    </div>
  {/if}
  {#if auth.error}<p class="err">{auth.error}</p>{/if}
</div>

<style>
  .signin.compact .actions {
    justify-content: center;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .hint {
    flex: 1;
    font-size: 12px;
    color: var(--color-dim);
  }
  .signin.compact .hint {
    flex: none;
  }
  .code-label {
    margin: 8px 0 2px;
    font-size: 12px;
    color: var(--color-dim);
  }
  .code {
    margin: 0 0 8px;
    font-family: var(--mono);
    font-size: 22px;
    letter-spacing: 0.18em;
    color: var(--color2);
    user-select: all;
  }
  .err {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--red);
  }
</style>
