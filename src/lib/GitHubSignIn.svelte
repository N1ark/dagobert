<script lang="ts">
  import { copyText, IconButton } from "purr";
  import { auth } from "./auth.svelte";
  import { backend } from "./backend";
  import { GithubLogo, Copy, Check } from "purr/icons";
  import { t } from "./i18n";

  /** Shown on the welcome screen as well as in settings, so it lives on its own. */
  let { compact = false }: { compact?: boolean } = $props();

  let copied = $state(false);

  function copy() {
    if (!auth.code) return;
    void copyText(auth.code).then((ok) => {
      if (!ok) return;
      copied = true;
      setTimeout(() => (copied = false), 1500);
    });
  }
</script>

<div class="signin" class:compact>
  {#if auth.code}
    <p class="code-label">{t("settings.github.code")}</p>
    <div class="code-row">
      <p class="code">{auth.code}</p>
      <IconButton
        label={t("settings.github.copy")}
        tip={t(copied ? "settings.github.copied" : "settings.github.copy")}
        size="lg"
        onclick={copy}
        >{#if copied}<Check />{:else}<Copy />{/if}</IconButton
      >
    </div>
    <div class="actions">
      <span class="hint">{t("settings.github.waiting")}</span>
      <button class="btn" onclick={() => auth.url && backend.openExternal(auth.url)}>{t("settings.github.reopen")}</button>
      <button class="btn btn--ghost" onclick={() => auth.cancel()}>{t("settings.github.cancel")}</button>
    </div>
  {:else if auth.signedIn}
    <div class="actions">
      <span class="hint">{t("settings.github.signedInAs", { login: auth.session?.login ?? "" })}</span>
      <button class="btn btn--ghost" onclick={() => auth.signOut()}>{t("settings.github.signout")}</button>
    </div>
  {:else}
    <div class="actions">
      <button class="btn btn--primary" class:btn--lg={compact} disabled={auth.busy} onclick={() => auth.signIn()}
        ><GithubLogo /> {t("settings.github.signin")}</button
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
    gap: var(--gap-4);
    flex-wrap: wrap;
    margin-top: var(--gap-4);
  }
  .hint {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .signin.compact .hint {
    flex: none;
  }
  .code-label {
    margin: var(--gap-4) 0 var(--gap-1);
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .code-row {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    margin-bottom: var(--gap-4);
  }
  .signin.compact .code-row {
    justify-content: center;
  }
  .code {
    margin: 0;
    font-family: var(--mono);
    font-size: 22px;
    letter-spacing: 0.18em;
    color: var(--color2);
    -webkit-user-select: all;
    user-select: all;
  }
  .err {
    margin: var(--gap-3) 0 0;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
</style>
