// Device preferences (theme, language, layout), kept in localStorage.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { makeFormats, makeT, resolveLang, type Formats, type Lang, type Translate } from "./i18n";

export type Theme = "system" | "light" | "dark" | "rosepine" | "rosepine-dawn";

export interface Settings {
  theme: Theme;
  language: "auto" | Lang;
  sidebar: boolean;
  sidebarWidth: number;
  /** The side panel on the right: the selected device at a glance. */
  panel: boolean;
  /** Dashboard order: lowest battery first, or by name. */
  sort: "battery" | "name";
  /** Show devices that aren't connected anywhere right now. */
  showOffline: boolean;
  /** Blur serial numbers and addresses until hovered (screen sharing). */
  hideIdentifiers: boolean;
  /** Desktop: keep running in the tray when the window is closed. */
  closeToTray: boolean;
}

const STORAGE_KEY = "devices.settings";

const DEFAULTS: Settings = {
  theme: "system",
  language: "auto",
  sidebar: true,
  sidebarWidth: 248,
  panel: true,
  sort: "battery",
  showOffline: true,
  hideIdentifiers: true,
  closeToTray: true,
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

function save(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not critical.
  }
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  t: Translate;
  f: Formats;
  lang: Lang;
  /** The theme in effect ("system" resolved). */
  dark: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);
  const [systemDark, setSystemDark] = useState(darkQuery.matches);

  useEffect(() => {
    const onChange = () => setSystemDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  const dark = resolvedTheme === "dark" || resolvedTheme === "rosepine";
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#ffffff");
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.classList.toggle("hide-identifiers", settings.hideIdentifiers);
  }, [settings.hideIdentifiers]);

  const value = useMemo<SettingsContextValue>(() => {
    const lang = resolveLang(settings.language);
    document.documentElement.lang = lang;
    return {
      settings,
      update: (patch) =>
        setSettings((s) => {
          const next = { ...s, ...patch };
          save(next);
          return next;
        }),
      t: makeT(lang),
      f: makeFormats(lang),
      lang,
      dark,
    };
  }, [settings, dark]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings outside SettingsProvider");
  return value;
}
