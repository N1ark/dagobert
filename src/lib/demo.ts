/** A small, tidy project for the README screenshot: `npm run dev`, then open `/?demo`. */
import type { IssueRef } from "./github";
import type { Meta, Note } from "./types";

export const demo = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");

/** The note open in the side panel. */
export const DEMO_SELECTED = "docs";

const REPO = "atlas-maps/atlas";

export const demoMeta: Meta = {
  tag_colors: { design: "#c678dd", api: "#61afef", docs: "#98c379" },
  workflows: [
    {
      id: "pr",
      name: "Pull request",
      stages: [
        { name: "draft", done: false },
        { name: "review", done: false },
        { name: "merged", done: true, color: "#b045ab" },
      ],
      template: "",
    },
  ],
  default_template: "",
  tracking_template: "",
  repos: { atlas: REPO },
  palette: [],
  git: { enabled: false, interval_min: 5 },
};

type Seed = Pick<Note, "id" | "title" | "tags" | "deps" | "x" | "y" | "body"> & Partial<Note>;

const SEEDS: Seed[] = [
  {
    id: "sketch",
    title: "Sketch the onboarding",
    tags: ["design"],
    deps: [],
    x: 0,
    y: 140,
    status: "done",
    body: "Three screens, all skippable.",
  },
  {
    id: "tiles",
    title: "Offline tile cache",
    tags: ["api"],
    deps: [],
    x: 0,
    y: 280,
    workflow: "pr",
    status: "merged",
    body: "Landed in atlas#41, tiles live in one `.pmtiles` file.",
  },
  {
    id: "colours",
    title: "Brand colours",
    tags: ["design"],
    deps: [],
    x: 0,
    y: 0,
    status: "done",
    body: "Ink, paper and one *violet*.",
  },
  {
    id: "screens",
    title: "Onboarding screens",
    tags: ["design"],
    deps: ["sketch", "colours"],
    x: 300,
    y: 140,
    workflow: "pr",
    status: "review",
    body: "Three screens, each skippable, in the [[Brand colours]].\n\nIn review as atlas#52, copy tweaks landed in atlas#49.",
  },
  {
    id: "search",
    title: "Place search",
    tags: ["api"],
    deps: ["tiles"],
    x: 300,
    y: 280,
    body: "Fuzzy match on place names, see atlas#57.",
  },
  {
    id: "landing",
    title: "Landing page",
    tags: ["design"],
    deps: ["colours"],
    x: 300,
    y: 0,
    status: "done",
    body: "One page, one screenshot, one button.",
  },
  {
    id: "docs",
    title: "Write the docs",
    tags: ["docs"],
    deps: ["screens", "search"],
    x: 600,
    y: 210,
    body: [
      "Once [[Onboarding screens]] and [[Place search]] land.",
      "",
      "- [x] Getting started",
      "- [ ] Downloading a region for offline use",
      "- [ ] FAQ",
      "",
      "Screenshots wait on atlas#52, and big regions still search slowly (atlas#57).",
      "",
      "```sh",
      "atlas download --region lisbon",
      "```",
    ].join("\n"),
  },
  {
    id: "release",
    title: "Release 1.0",
    tags: [],
    deps: ["landing", "docs"],
    x: 900,
    y: 105,
    tracking: true,
    body: "Ship to the App Store and the website on the same day.",
  },
];

export function demoNotes(): Note[] {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return SEEDS.map((s, i) => ({
    created: at(60 * 24 * 14 - i * 90),
    modified: at(i * 37 + 5),
    workflow: null,
    status: "todo",
    width: null,
    file: `${s.id}.md`,
    ...s,
  }));
}

const issue = (number: number, title: string, isPr: boolean, state: IssueRef["state"], author: string, comments: number): IssueRef => ({
  number,
  title,
  isPr,
  state,
  url: `https://github.com/${REPO}/${isPr ? "pull" : "issues"}/${number}`,
  updated: new Date(Date.now() - number * 3_600_000).toISOString(),
  author,
  draft: false,
  notPlanned: false,
  comments,
});

/** Stand-ins for GitHub, keyed `owner/name#number`, so the refs show real state icons offline. */
export const demoIssues: Record<string, IssueRef> = Object.fromEntries(
  [
    issue(41, "Cache map tiles on disk", true, "merged", "mira", 6),
    issue(49, "Friendlier onboarding copy", true, "merged", "jonas", 2),
    issue(52, "Onboarding flow", true, "open", "mira", 4),
    issue(57, "Search is slow on large regions", false, "open", "sam", 3),
  ].map((i) => [`${REPO}#${i.number}`, i]),
);
