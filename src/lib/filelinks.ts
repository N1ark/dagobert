/** Links to local files and folders: `[name](path)`, the path absolute, `~/…`, `file://…` or relative to the note. */

/** A link to a local path rather than a page: no URL scheme (or `file:`), and not an anchor. */
export function isLocalHref(href: string): boolean {
  if (!href || /^[#?]/.test(href) || href.startsWith("//")) return false;
  if (/^([a-z]:[\\/]|file:)/i.test(href)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

/** The markdown for a link to `target` named `name`; `%`, `<`, `>` and `\` are percent-encoded, spaces bracketed. */
export function fileLink(name: string, target: string): string {
  const dest = target.replace(/[%<>\\]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const label = name.replace(/[[\]\\`*]/g, "\\$&");
  return `[${label}](${/[\s()]/.test(dest) ? `<${dest}>` : dest})`;
}

/** A path's last segment: the name a dropped or picked file is linked as. */
export const baseName = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || path;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The anchor a local link renders as; `fileLinkIcons` gives it its icon, state and tooltip (the path). */
export function fileLinkHtml(href: string, inner: string): string {
  return `<a class="filelink" data-path="${esc(href)}">${inner}</a>`;
}
