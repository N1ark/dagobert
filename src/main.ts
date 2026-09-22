import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { isMobile } from "./lib/backend";

document.body.classList.toggle("mobile", isMobile);

// The software keyboard shrinks the visual viewport without moving the layout
// one; `--kb` is how much of the screen it covers, so the sheet can clear it.
// Nothing here is a scrolling document, but iOS scrolls it to lift a focused
// field above the keyboard. Leave that alone and undo it once the field is done.
if (isMobile) {
  const typing = () => !!document.activeElement?.closest("input, textarea, [contenteditable]");
  window.addEventListener("scroll", () => !typing() && window.scrollTo(0, 0), { passive: true });
  window.addEventListener("focusout", () => setTimeout(() => !typing() && window.scrollTo(0, 0), 50));
}

const vv = window.visualViewport;
if (isMobile && vv) {
  const track = () => document.documentElement.style.setProperty("--kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener("resize", track);
  vv.addEventListener("scroll", track);
  track();
}

const app = mount(App, { target: document.getElementById("app")! });

export default app;

if (import.meta.env.DEV) {
  import("./lib/store.svelte").then((m) => ((window as unknown as { store: unknown }).store = m.store));
}
