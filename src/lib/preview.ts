/** Link previews: what a page says about itself (Open Graph, Twitter cards, plain HTML), for `![](https://…)`. */

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
  icon: string | null;
  /** The link is an image itself: it renders as one. */
  isImage?: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** A tag's attributes, names lower-cased, values decoded. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

const absolute = (href: string | undefined, base: string) => {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

/** Reads a page's preview: the first of `og:`, `twitter:` and plain HTML that says each thing. */
export function parsePreview(html: string, url: string): LinkPreview {
  const end = html.search(/<\/head>/i);
  const head = end >= 0 ? html.slice(0, end) : html;
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content;
  }
  let icon: string | undefined;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = a.rel?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes("apple-touch-icon") || (!icon && rel.includes("icon"))) icon = a.href;
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const pick = (...keys: string[]) => keys.map((k) => meta[k]).find((v) => v?.trim()) ?? null;
  return {
    url,
    title: pick("og:title", "twitter:title") ?? (title ? decode(title) || null : null),
    description: pick("og:description", "twitter:description", "description"),
    image: absolute(pick("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src") ?? undefined, url),
    site: pick("og:site_name", "application-name"),
    icon: absolute(icon ?? "/favicon.ico", url),
  };
}

/** The host a card names when the page doesn't: `github.com`. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A link's card: the page's image, title, description and site; just the link while `p` is null. */
export function cardHtml(url: string, p: LinkPreview | null): string {
  const site = p?.site || hostOf(url);
  const icon = p?.icon ? `<img class="lc-icon" src="${esc(p.icon)}" alt="">` : "";
  const image = p?.image ? `<img class="lc-image" src="${esc(p.image)}" alt="" loading="lazy">` : "";
  const desc = p?.description ? `<span class="lc-desc">${esc(p.description)}</span>` : "";
  return (
    `<a class="link-card${p ? "" : " loading"}" href="${esc(url)}" data-card="${esc(url)}">${image}` +
    `<span class="lc-text"><span class="lc-title">${esc(p?.title || url)}</span>${desc}` +
    `<span class="lc-site">${icon}${esc(site)}</span></span></a>`
  );
}
