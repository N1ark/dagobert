<script lang="ts">
  import { ACCENTS, accentSwatch, ColorGrid, liveTheme, Segmented, SettingGroup, SettingRow, type ThemeMode } from "purr";
  import { Desktop, Moon, Sun } from "purr/icons";
  import { appearance, DONE_OPACITY, previewAppearance, setAppearance } from "./appearance.svelte";
  import { t, type Key } from "./i18n";

  const themes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
    { id: "system", label: t("settings.appearance.theme.system"), icon: Desktop },
    { id: "light", label: t("settings.appearance.theme.light"), icon: Sun },
    { id: "dark", label: t("settings.appearance.theme.dark"), icon: Moon },
  ];
  const ACCENT_NAMES: Record<string, Key> = {
    purple: "settings.appearance.accent.purple",
    magenta: "settings.appearance.accent.magenta",
    red: "settings.appearance.accent.red",
    amber: "settings.appearance.accent.amber",
    green: "settings.appearance.accent.green",
    teal: "settings.appearance.accent.teal",
    blue: "settings.appearance.accent.blue",
    slate: "settings.appearance.accent.slate",
  };
  // Swatches in the painted theme, mapped back to accent ids.
  const swatches = $derived(new Map(ACCENTS.map((a) => [accentSwatch(a.id, liveTheme.current), a.id])));
  const accentName = (id: string) => (ACCENT_NAMES[id] ? t(ACCENT_NAMES[id]) : id);
</script>

<SettingGroup description={t("settings.appearance.help")}>
  <SettingRow label={t("settings.appearance.theme")}>
    <Segmented
      options={themes}
      value={appearance.theme}
      label={t("settings.appearance.theme")}
      size="sm"
      onchange={(theme) => setAppearance({ theme })}
    />
  </SettingRow>
  <SettingRow label={t("settings.appearance.accent")} sub={t("settings.appearance.accent.sub")}>
    <ColorGrid
      colors={[...swatches.keys()]}
      value={accentSwatch(appearance.accent, liveTheme.current)}
      onpick={(c) => c && setAppearance({ accent: swatches.get(c) ?? appearance.accent })}
      label={t("settings.appearance.accent")}
      shape="round"
      colorLabel={(c) => accentName(swatches.get(c) ?? "")}
      colorTip={(c) => accentName(swatches.get(c) ?? "")}
    />
  </SettingRow>
  <SettingRow label={t("settings.appearance.done")} sub={t("settings.appearance.done.sub")} for="done-opacity">
    <input
      id="done-opacity"
      class="slider"
      type="range"
      min={DONE_OPACITY.min}
      max={DONE_OPACITY.max}
      step="0.05"
      value={appearance.doneOpacity}
      oninput={(e) => previewAppearance({ doneOpacity: Number(e.currentTarget.value) })}
      onchange={() => setAppearance()}
    />
    <span class="pct">{Math.round(appearance.doneOpacity * 100)}%</span>
  </SettingRow>
</SettingGroup>

<style>
  .slider {
    width: 140px;
    accent-color: var(--theme);
  }
  .pct {
    min-width: 3.5ch;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--muted);
  }
</style>
