/**
 * The two tokens the app holds: the GitHub API token and the git push/pull
 * token, plus the commit identity a cloned project gets. `localStorage` today;
 * the interface exists so a keychain plugin can replace the backing later.
 */
const PREFIX = "dagobert.";

function read(key: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value.trim()) localStorage.setItem(PREFIX + key, value.trim());
    else localStorage.removeItem(PREFIX + key);
  } catch {}
}

export const secrets = {
  githubToken: () => read("githubToken"),
  setGithubToken: (v: string) => write("githubToken", v),
  /** Sent to Rust for each fetch/push; never written to disk by the backend. */
  gitToken: () => read("gitToken"),
  setGitToken: (v: string) => write("gitToken", v),
  gitName: () => read("gitName"),
  setGitName: (v: string) => write("gitName", v),
  gitEmail: () => read("gitEmail"),
  setGitEmail: (v: string) => write("gitEmail", v),
};
