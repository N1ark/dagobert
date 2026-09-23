/** Instant tooltip action: `use:tooltip={"Automatic"}`, unlike `title`, which waits a second. */
import type { Action } from "svelte/action";

let el: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;

function ensure() {
  if (el) return el;
  el = document.createElement("div");
  el.className = "tooltip";
  el.setAttribute("role", "tooltip");
  document.body.appendChild(el);
  return el;
}

function show(target: HTMLElement, text: Content) {
  const t = ensure();
  owner = target;
  // `html` must already be sanitised (DOMPurify) by the caller.
  if (typeof text === "string") t.textContent = text;
  else t.innerHTML = text.html;
  t.classList.add("show");
  const r = target.getBoundingClientRect();
  const gap = 6;
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(4, Math.min(window.innerWidth - w - 4, x));
  let y = r.top - gap - h;
  if (y < 4) y = r.bottom + gap;
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function hide(target: HTMLElement) {
  if (owner !== target || !el) return;
  owner = null;
  el.classList.remove("show");
}

/** Plain text, or pre-sanitised HTML (e.g. rendered inline markdown). */
type Content = string | { html: string };
type Text = Content | null | undefined;
/** Static content, or a function evaluated on each hover (e.g. only when the label overflows). */
type Source = Text | ((node: HTMLElement) => Text);

export const tooltip: Action<HTMLElement, Source> = (node, text) => {
  let current = text;
  const resolve = () => (typeof current === "function" ? current(node) : current);
  const enter = () => {
    const t = resolve();
    if (t) show(node, t);
  };
  const leave = () => hide(node);
  node.addEventListener("pointerenter", enter);
  node.addEventListener("pointerleave", leave);
  node.addEventListener("pointerdown", leave);
  node.addEventListener("focus", enter);
  node.addEventListener("blur", leave);
  return {
    update(next) {
      current = next;
      if (owner === node) {
        const t = resolve();
        if (t) show(node, t);
        else hide(node);
      }
    },
    destroy() {
      hide(node);
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
      node.removeEventListener("pointerdown", leave);
      node.removeEventListener("focus", enter);
      node.removeEventListener("blur", leave);
    },
  };
};
