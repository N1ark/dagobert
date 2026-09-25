import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { backend, inTauri, isMobile } from "./lib/backend";

document.body.classList.toggle("mobile", isMobile);

// `--kb` is how much of the screen the keyboard covers; WKWebView only knows via UIKit.
const setKb = (px: number) => {
  const kb = Math.max(0, Math.round(px));
  document.documentElement.style.setProperty("--kb", `${kb}px`);
  document.body.classList.toggle("keyboard", kb > 0);
};
if (isMobile) {
  backend.onKeyboard(setKb);
  // The net for the scrolls WKWebView performs on its own; nothing here scrolls.
  window.addEventListener("scroll", () => (window.scrollX || window.scrollY) && window.scrollTo(0, 0), { passive: true });
}

// In the browser dev loop there is no UIKit, but the visual viewport does shrink.
const vv = window.visualViewport;
if (isMobile && !inTauri && vv) {
  const track = () => setKb(window.innerHeight - vv.height - vv.offsetTop);
  vv.addEventListener("resize", track);
  vv.addEventListener("scroll", track);
  track();
}

const app = mount(App, { target: document.getElementById("app")! });

export default app;

if (import.meta.env.DEV) {
  import("./lib/store.svelte").then((m) => ((window as unknown as { store: unknown }).store = m.store));
}
