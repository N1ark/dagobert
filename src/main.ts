import { mount } from "svelte";
import { applyPlatform, applyTheme } from "purr";
import "purr/fonts.css";
import "purr/styles.css";
import "purr/shell.css";
import "./app.css";
import App from "./App.svelte";
import { backend, inTauri, isMobile } from "./lib/backend";

applyTheme({ mode: "dark" });
// WKWebView only learns the keyboard's height from UIKit; the browser dev loop uses the visual viewport.
applyPlatform({ mobile: isMobile, keyboard: inTauri ? backend.onKeyboard : undefined });

const app = mount(App, { target: document.getElementById("app")! });

export default app;

if (import.meta.env.DEV) {
  import("./lib/store.svelte").then((m) => ((window as unknown as { store: unknown }).store = m.store));
}
