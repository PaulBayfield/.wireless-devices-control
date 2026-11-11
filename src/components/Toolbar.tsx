// The top bar, laid out like Calendar's, Notes' and Llip's: title on the left; account and actions
// on the right; then the side panel toggle.

import { useRef, useState, type ReactNode } from "react";
import { isTauri } from "../lib/api";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { Dropdown as Floating } from "./pickers";
import { PanelLeft, PanelRight, Refresh, WinMaximize, WinMinimize, X } from "./icons";

export function Toolbar({ title, loading }: { title: ReactNode; loading?: boolean }) {
  const { t } = useSettings();
  const { sidebarVisible, toggleSidebar, panelVisible, togglePanel, refresh, refreshing, local } = useApp();
  return (
    <header className="toolbar" data-tauri-drag-region>
      {!sidebarVisible && (
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
      )}
      <h1 className="toolbar-title" data-tauri-drag-region>
        {title}
      </h1>
      {loading && <span className="spinner" aria-label={t("loading")} />}
      <div className="toolbar-spacer" data-tauri-drag-region />
      <AccountMenu />
      <button className="text-button" title={`${t("refreshHint")} (R)`} disabled={refreshing} onClick={() => void refresh()}>
        <span className={refreshing ? "spin" : ""} style={{ display: "inline-flex" }}>
          <Refresh size={14} />
        </span>
        <span className="hide-mobile">{refreshing ? t("refreshing") : t("refresh")}</span>
        {local.agent && <span className="sr-only">{t("thisComputer")}</span>}
      </button>
      <button
        className={`icon-button panel-toggle${panelVisible ? " active" : ""}`}
        title={`${t("togglePanel")} (.)`}
        aria-label={t("togglePanel")}
        aria-pressed={panelVisible}
        onClick={togglePanel}
      >
        <PanelRight />
      </button>
      {isTauri && !panelVisible && <WindowControls />}
    </header>
  );
}

function AccountMenu() {
  const { t } = useSettings();
  const { me, openSettings, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className="menu-anchor">
      <button ref={anchor} className="avatar" title={me.email ?? me.id} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        {(me.name.trim()[0] ?? "?").toUpperCase()}
      </button>
      {open && (
        <Floating anchor={anchor} onClose={() => setOpen(false)} className="menu-floating">
          <div className="menu" role="menu">
            <div className="menu-label">{me.email ?? me.id}</div>
            <button
              onClick={() => {
                setOpen(false);
                openSettings("profile");
              }}
            >
              <span>{t("settings")}</span>
              <span className="keys">
                <kbd>Ctrl</kbd> <kbd>,</kbd>
              </span>
            </button>
            <button onClick={signOut}>{t("signOut")}</button>
          </div>
        </Floating>
      )}
    </div>
  );
}

/** The desktop window has no system title bar: minimize, maximize and close live in the app's. */
export function WindowControls() {
  const { t } = useSettings();
  const run = (action: "minimize" | "toggleMaximize" | "close") => async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  };
  return (
    <div className="window-controls">
      <button aria-label={t("minimize")} onClick={run("minimize")}>
        <WinMinimize size={14} />
      </button>
      <button aria-label={t("maximize")} onClick={run("toggleMaximize")}>
        <WinMaximize size={12} />
      </button>
      <button className="close" aria-label={t("close")} onClick={run("close")}>
        <X size={14} />
      </button>
    </div>
  );
}
