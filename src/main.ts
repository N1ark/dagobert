import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { backend, inTauri, isMobile } from "./lib/backend";

document.body.classList.toggle("mobile", isMobile);

// The keyboard's height comes from UIKit, because WKWebView never tells the web
// layer about it. `--kb` is how much of the screen it covers; the shell shrinks
// by that much, so nothing has to be scrolled out of its way.
if (isMobile) {
  const setKb = (px: number) => document.documentElement.style.setProperty("--kb", `${Math.max(0, Math.round(px))}px`);
  backend.onKeyboard(setKb);
  const typing = () => !!document.activeElement?.closest("input, textarea, [contenteditable]");
  const sync = () => document.body.classList.toggle("typing", typing());
  document.addEventListener("focusin", sync);
  document.addEventListener("focusout", () => setTimeout(sync, 50));
  // Nothing here is a scrolling document; the keyboard is accounted for above.
  window.addEventListener("scroll", () => (window.scrollX || window.scrollY) && window.scrollTo(0, 0), { passive: true });
}

// In the browser dev loop there is no UIKit, but the visual viewport does shrink.
const vv = window.visualViewport;
if (isMobile && !inTauri && vv) {
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
