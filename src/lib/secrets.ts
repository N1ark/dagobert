/** The GitHub sign-in as stored between launches; one token serves the API and git over HTTPS. */
const KEY = "dagobert.session";

/** A signed-in GitHub session. `refresh` and `expires` are null when the app issues non-expiring tokens. */
export interface Session {
  access: string;
  refresh: string | null;
  /** Epoch ms the access token stops working. */
  expires: number | null;
  login: string;
  name: string;
  email: string;
}

export const secrets = {
  session(): Session | null {
    try {
      const raw = localStorage.getItem(KEY);
      const s = raw ? (JSON.parse(raw) as Session) : null;
      return s?.access ? s : null;
    } catch {
      return null;
    }
  },

  setSession(s: Session | null) {
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch {}
  },
};
