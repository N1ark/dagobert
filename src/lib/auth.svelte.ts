/** GitHub App sign-in: a code approved in the browser, for both the REST API and git. */
import { backend } from "./backend";
import { secrets, type Session } from "./secrets";
import { t } from "./i18n";
import type { Token } from "./types";

/** Refresh this long before expiry, so a sync never starts on a dead token. */
const EARLY = 60_000;

/** The signed-in user, for the commit identity. api.github.com allows CORS, so this needs no command. */
async function whoami(token: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const u = (await res.json()) as { login: string; name: string | null; email: string | null };
  // Users with a private email get the noreply address git will accept.
  return { login: u.login, name: u.name || u.login, email: u.email ?? `${u.login}@users.noreply.github.com` };
}

class Auth {
  session = $state<Session | null>(secrets.session());
  /** The code to type in the browser, while a sign-in is in flight. */
  code = $state<string | null>(null);
  url = $state<string | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);

  #cancelled = false;
  #refreshing: Promise<string | null> | null = null;

  get signedIn() {
    return !!this.session;
  }

  #save(s: Session | null) {
    this.session = s;
    secrets.setSession(s);
  }

  /** Runs the device flow to completion; resolves true once signed in. */
  async signIn(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.error = null;
    this.#cancelled = false;
    try {
      const start = await backend.githubSigninStart();
      this.code = start.user_code;
      this.url = start.verification_uri;
      await backend.openExternal(start.verification_uri);
      let interval = Math.max(5, start.interval);
      const deadline = Date.now() + start.expires_in * 1000;
      while (!this.#cancelled && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        if (this.#cancelled) break;
        const res = await backend.githubSigninPoll(start.device_code);
        if (res.state === "slow-down") interval = res.interval;
        else if (res.state === "token") {
          await this.#adopt(res.token);
          return true;
        }
      }
      if (!this.#cancelled) this.error = t("github.signin.expired");
      return false;
    } catch (e) {
      this.error = String(e) === "no-client-id" ? t("github.signin.unconfigured") : String(e);
      return false;
    } finally {
      this.busy = false;
      this.code = null;
      this.url = null;
    }
  }

  cancel() {
    this.#cancelled = true;
  }

  signOut() {
    this.#save(null);
  }

  /** Stores a fresh token and the identity commits are attributed to. */
  async #adopt(token: Token) {
    const base: Session = {
      access: token.access_token,
      refresh: token.refresh_token,
      expires: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
      login: this.session?.login ?? "",
      name: this.session?.name ?? "",
      email: this.session?.email ?? "",
    };
    this.#save(base);
    const who = await whoami(base.access).catch(() => null);
    if (who) this.#save({ ...base, ...who });
  }

  /** Adopts whatever another window last stored, since each window holds its own copy. */
  #reload() {
    const stored = secrets.session();
    if (stored?.access !== this.session?.access) this.session = stored;
    return this.session;
  }

  /** A usable access token, refreshed if it is about to expire. Null when signed out. */
  async token(): Promise<string | null> {
    const s = this.#reload();
    if (!s) return null;
    if (!s.expires || Date.now() < s.expires - EARLY) return s.access;
    if (!s.refresh) {
      // Expired with nothing to refresh from: the sign-in is simply over.
      this.#save(null);
      return null;
    }
    this.#refreshing ??= (async () => {
      try {
        const res = await backend.githubRefresh(s.refresh!);
        if (res.state === "token") {
          await this.#adopt(res.token);
          return this.session?.access ?? null;
        }
        // GitHub rotates on every use, so a refusal may just mean another window got there first.
        if (this.#reload()?.refresh === s.refresh) this.#save(null);
        return this.session?.access ?? null;
      } catch {
        // GitHub was unreachable: keep the sign-in and let the next cycle retry.
        return null;
      } finally {
        this.#refreshing = null;
      }
    })();
    return this.#refreshing;
  }
}

export const auth = new Auth();
