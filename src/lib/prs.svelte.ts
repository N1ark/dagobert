import type { IssueRef } from "./github";

/**
 * Fetched PR details shared by every mount of `PullRequests.svelte`, keyed
 * `owner/repo#number`. Lives outside the component so closing and reopening the
 * sidebar shows the last result instantly instead of refetching. `null` marks a
 * reference that isn't a pull request (or doesn't exist) so it isn't retried.
 */
export const prCache = $state({
  details: {} as Record<string, IssueRef | null>,
  errors: {} as Record<string, string>,
});
