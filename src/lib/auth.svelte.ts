/** GitHub App sign-in: a code approved in the browser, for both the REST API and git. */
import { readFlag, writeFlag } from "purr";
import { backend, isMobile } from "./backend";
import { secrets, type Session } from "./secrets";
import { t, type Key } from "./i18n";
import type { Token } from "./types";

/** Refresh this long before expiry, so a sync never starts on a dead token. */
const EARLY = 60_000;
/** App-wide: use the GitHub CLI's token before the sign-in. */
const USE_GH = "dagobert.useGh";
/** A failed `gh auth token` isn't run again for this long. */
const GH_RETRY = 60_000;

/** The GitHub CLI's account, or the reason its token can't be used (a locale key). */
export type GhStatus = { login: string } | { error: Key } | null;

const GH_ERRORS: Record<string, Key> = {
  "gh-missing": "github.gh.missing",
  "gh-signed-out": "github.gh.signedOut",
  "gh-rejected": "github.gh.rejected",
};

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

  #useGh = $state(!isMobile && readFlag(USE_GH, false));
  /** Shown in settings; null until checked. */
  gh = $state<GhStatus>(null);
  /** Held in memory only, never stored. */
  #ghToken: string | null = null;
  #ghFailedAt = -Infinity;
  #ghRejected: string | null = null;
  #ghFetching: Promise<string | null> | null = null;

  get signedIn() {
    return !!this.session;
  }

  /** Whether API calls and git use the GitHub CLI's token, falling back to the sign-in. */
  get useGh() {
    return this.#useGh;
  }

  set useGh(on: boolean) {
    this.#useGh = on;
    writeFlag(USE_GH, on);
    this.#ghToken = null;
    this.gh = null;
    if (on) void this.checkGh();
  }

  /** Reads the CLI's token afresh and looks up whose it is. */
  async checkGh() {
    this.#ghFailedAt = -Infinity;
    const tok = await this.#gh();
    if (!tok) return;
    try {
      this.gh = { login: (await whoami(tok)).login };
    } catch (e) {
      if (String(e).includes("401")) this.rejected(tok);
      else this.gh = { error: "github.gh.unreachable" };
    }
  }

  async #gh(): Promise<string | null> {
    if (this.#ghToken) return this.#ghToken;
    if (Date.now() - this.#ghFailedAt < GH_RETRY) return null;
    this.#ghFetching ??= (async () => {
      try {
        const tok = await backend.ghToken();
        if (tok === this.#ghRejected) throw new Error("gh-rejected");
        this.#ghToken = tok;
        return tok;
      } catch (e) {
        const code = e instanceof Error ? e.message : String(e);
        this.#ghFailedAt = Date.now();
        this.gh = { error: GH_ERRORS[code] ?? "github.gh.unreachable" };
        return null;
      } finally {
        this.#ghFetching = null;
      }
    })();
    return this.#ghFetching;
  }

  /** A request got 401 with `token`: when it was the CLI's, ask `gh` again (once) and fall back to the sign-in. */
  rejected(token: string): boolean {
    if (token !== this.#ghToken) return false;
    this.#ghRejected = token;
    this.#ghToken = null;
    this.gh = { error: "github.gh.rejected" };
    return true;
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

  /** The token for the API and git: the CLI's when that's on and it works, else the sign-in's. */
  async token(): Promise<string | null> {
    // Another window may have flipped the toggle.
    const on = !isMobile && readFlag(USE_GH, false);
    if (on !== this.#useGh) this.#useGh = on;
    return (on && (await this.#gh())) || this.appToken();
  }

  /** The sign-in's access token, refreshed if it is about to expire. Null when signed out. */
  async appToken(): Promise<string | null> {
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
