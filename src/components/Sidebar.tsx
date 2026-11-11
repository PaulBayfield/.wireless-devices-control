import { useRef, type CSSProperties, type ReactNode } from "react";
import { isCharging, isLow, useApp, type ListFilter } from "../lib/app";
import { useSettings } from "../lib/settings";
import { BatteryCharging, BatteryLow, DeviceIcon, Devices, Monitor, PanelLeft, Search } from "./icons";
import { batteryTone } from "./devices/Battery";

const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 248;

/** Same layout as the other apps' sidebars: toggle and search on top, then the lists. */
export function Sidebar() {
  const { t, f, settings } = useSettings();
  const { overview, list, route, navigate, setQuery, toggleSidebar, openSearch, openDevice } = useApp();
  const devices = overview?.devices ?? [];
  const onDevices = route.name === "devices";
  const hostFilter = route.name === "devices" ? route.host : undefined;

  const lists: { id: ListFilter; label: string; icon: ReactNode; count: number }[] = [
    { id: "all", label: t("allDevices"), icon: <Devices />, count: devices.length },
    { id: "low", label: t("lowBattery"), icon: <BatteryLow />, count: devices.filter(isLow).length },
    { id: "charging", label: t("charging"), icon: <BatteryCharging />, count: devices.filter(isCharging).length },
  ];

  return (
    <aside className="sidebar" style={{ "--sidebar-w": `${settings.sidebarWidth}px` } as CSSProperties}>
      <ResizeHandle />
      <div className="sidebar-top" data-tauri-drag-region>
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
        <div className="toolbar-spacer" data-tauri-drag-region />
        <button className="icon-button" title={`${t("search")} (Ctrl+K)`} aria-label={t("search")} onClick={openSearch}>
          <Search />
        </button>
      </div>

      <nav className="sidebar-nav">
        {lists.map((l) => (
          <button
            key={l.id}
            className={`sidebar-row${onDevices && !hostFilter && list === l.id ? " active" : ""}`}
            onClick={() => {
              navigate({ name: "devices" });
              if (l.id !== "all") setQuery({ filter: l.id }, true);
            }}
          >
            {l.icon}
            <span className="row-label">{l.label}</span>
            <span className="row-meta">{overview && l.count ? f.number(l.count) : ""}</span>
          </button>
        ))}
      </nav>

      {/* Only the lists scroll; the header stays put. */}
      <div className="sidebar-scroll">
        {(overview?.hosts.length ?? 0) > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("computers")}</div>
            {overview!.hosts.map((h) => (
              <button key={h.id} className={`sidebar-row${hostFilter === h.id ? " active" : ""}`} onClick={() => navigate({ name: "devices", host: h.id })}>
                <Monitor />
                <span className="row-label">{h.name}</span>
                <span className={`status-dot${h.online ? " on" : ""}`} title={h.online ? t("online") : t("offline")} />
              </button>
            ))}
          </div>
        )}
        {devices.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("devices")}</div>
            {devices.map((d) => (
              <button
                key={d.id}
                className={`sidebar-row${route.name === "device" && route.id === d.id ? " active" : ""}${d.connected ? "" : " empty"}`}
                title={d.name}
                onClick={() => openDevice(d.id)}
              >
                <DeviceIcon kind={d.kind} />
                <span className="row-label">{d.name}</span>
                <span className={`row-meta tabular tone-${batteryTone(d.battery?.percent ?? null)}`}>{d.battery?.percent != null ? `${d.battery.percent}%` : ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Drag the right edge to resize; double-click to reset. */
export function ResizeHandle() {
  const { update } = useSettings();
  const drag = useRef<{ x: number; w: number; aside: HTMLElement } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const aside = e.currentTarget.parentElement!;
        drag.current = { x: e.clientX, w: aside.getBoundingClientRect().width, aside };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("resizing-sidebar");
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) d.aside.style.setProperty("--sidebar-w", `${clamp(d.w + e.clientX - d.x)}px`);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        document.documentElement.classList.remove("resizing-sidebar");
        update({ sidebarWidth: clamp(d.w + e.clientX - d.x) });
      }}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_W })}
    />
  );
}
