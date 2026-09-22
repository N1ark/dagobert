import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { isMobile } from "./lib/backend";

document.body.classList.toggle("mobile", isMobile);

// The software keyboard shrinks the visual viewport without moving the layout
// one; `--kb` is how much of the screen it covers, so the sheet can clear it.
// WKWebView reports no keyboard through `visualViewport`, so iOS lifting the
// viewport is the only avoidance there is. Leave it be, mark that a field has
// the keyboard up (layout drops the home-indicator inset while it does), and
// put the scroll back once nothing is focused.
if (isMobile) {
  const typing = () => !!document.activeElement?.closest("input, textarea, [contenteditable]");
  const sync = () => document.body.classList.toggle("typing", typing());
  // The shell never scrolls, not even to reveal a focused field: letting it
  // would put the field the user is typing in behind the keyboard.
  const pin = () => (window.scrollX || window.scrollY) && window.scrollTo(0, 0);
  window.addEventListener("scroll", pin, { passive: true });
  document.addEventListener("focusin", () => (sync(), setTimeout(pin, 0)));
  document.addEventListener("focusout", () => setTimeout(() => (sync(), pin()), 50));
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
