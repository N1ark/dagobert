/** Self-update: checked a minute after launch and every few hours, downloaded quietly, installed on request. */
import { createUpdater, toast } from "purr";
import { backend, inTauri, isMobile } from "./backend";
import { t } from "./i18n";
import { store } from "./store.svelte";

export const updater = createUpdater({
  check: async () => {
    const version = await backend.checkUpdate();
    return version ? { version } : null;
  },
  restart: () => backend.installUpdate(),
  beforeRestart: () => store.suspend(),
  delay: 60_000,
  enabled: () => inTauri && !isMobile,
});

/** The version waiting for a restart, if any. */
export const readyVersion = () => (updater.ready ? (updater.info?.version ?? null) : null);

/** Asked for from the menu: says how it went. */
export async function checkNow() {
  toast(t("update.checking"));
  const found = await updater.check(true);
  if (updater.error) toast.error(updater.error);
  else toast(found ? t("update.ready", { version: found.version }) : t("update.latest"));
}

/** Saves and syncs like a quit, then relaunches into the new version. */
export async function install() {
  await updater.restart();
  if (updater.error) toast.error(updater.error);
}
