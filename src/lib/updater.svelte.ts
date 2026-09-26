/** Self-update: checked shortly after launch and every few hours, downloaded quietly, installed on request. */
import { backend, inTauri, isMobile } from "./backend";
import { t } from "./i18n";
import { store } from "./store.svelte";

const EVERY = 6 * 60 * 60 * 1000;
/** The first check waits until launch has settled. */
const FIRST = 60 * 1000;

class Updater {
  /** Version downloaded and waiting for a restart. */
  ready = $state<string | null>(null);
  #checking = false;

  /** Automatic checks stay quiet; `manual` toasts the outcome. */
  async check(manual = false) {
    if (this.#checking) return;
    this.#checking = true;
    if (manual) store.toast(t("update.checking"));
    try {
      this.ready = await backend.checkUpdate();
      if (manual) store.toast(this.ready ? t("update.ready", { version: this.ready }) : t("update.latest"));
    } catch (e) {
      if (manual) store.fail(e);
      else console.error("update check", e);
    } finally {
      this.#checking = false;
    }
  }

  /** Saves and syncs like a quit, then relaunches into the new version. */
  async install() {
    await store.suspend();
    try {
      await backend.installUpdate();
    } catch (e) {
      this.ready = null;
      store.fail(e);
    }
  }

  /** Main window only. Returns a stop function. */
  start(): () => void {
    if (!inTauri || isMobile) return () => {};
    const first = setTimeout(() => void this.check(), FIRST);
    const timer = setInterval(() => void this.check(), EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }
}

export const updater = new Updater();
