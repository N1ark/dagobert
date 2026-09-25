import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import ocaml from "highlight.js/lib/languages/ocaml";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { MarkedExtension } from "marked";

const languages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  haskell,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  makefile,
  markdown,
  ocaml,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};
for (const [name, lang] of Object.entries(languages)) hljs.registerLanguage(name, lang);
hljs.registerAliases(["sh", "zsh", "shell"], { languageName: "bash" });
hljs.registerAliases(["svelte", "html", "vue"], { languageName: "xml" });
hljs.registerAliases(["toml"], { languageName: "ini" });

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The language name from a fence's info string (`ts title="x"` → `ts`). */
const langOf = (info: string | undefined) => info?.trim().split(/\s+/)[0].toLowerCase() ?? "";

/** Highlight `code` as `lang` (unknown or missing language → escaped plain text). */
export function highlight(code: string, lang: string | undefined): string {
  const l = langOf(lang);
  if (!l || !hljs.getLanguage(l)) return escape(code);
  return hljs.highlight(code, { language: l, ignoreIllegals: true }).value;
}

/** marked extension: fenced code → `<pre><code class="hljs language-x">…` with hljs spans. */
export const highlightExtension: MarkedExtension = {
  renderer: {
    code({ text, lang }) {
      const l = langOf(lang);
      return `<pre><code class="hljs${l ? ` language-${escape(l)}` : ""}">${highlight(text, l)}\n</code></pre>\n`;
    },
  },
};
