<script lang="ts">
  // Settings → GitHub, desktop only: use the GitHub CLI's token, with whose account it is.
  import { onMount } from "svelte";
  import { auth } from "./auth.svelte";
  import { refreshPRs } from "./prs.svelte";
  import InlineMd from "./InlineMd.svelte";
  import { t } from "./i18n";

  const gh = $derived(auth.gh);

  onMount(() => {
    if (auth.useGh) void auth.checkGh();
  });

  function toggle(on: boolean) {
    auth.useGh = on;
    refreshPRs();
  }
</script>

<label class="row">
  <input type="checkbox" class="checkbox" checked={auth.useGh} onchange={(e) => toggle(e.currentTarget.checked)} />
  {t("settings.github.gh")}
</label>
<p class="help"><InlineMd source={t("settings.github.gh.help")} /></p>
{#if auth.useGh}
  <p class="status" class:err={gh && "error" in gh}>
    {#if !gh}{t("settings.github.gh.checking")}{:else if "login" in gh}{t("settings.github.gh.as", { login: gh.login })}{:else}<InlineMd
        source={t(gh.error)}
      />{/if}
  </p>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    margin: var(--sp-4) 0 0;
    font-size: var(--fs-sm);
    color: var(--color);
  }
  .help {
    margin: var(--gap-2) 0 0;
    font-size: var(--fs-xs);
    color: var(--muted);
  }
  .status {
    margin: var(--gap-3) 0 0;
    font-size: var(--fs-xs);
    color: var(--color2);
  }
  .status.err {
    color: var(--danger);
  }
</style>
