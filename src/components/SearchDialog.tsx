// Ctrl+K / "/": the same command palette as the other apps'. Jumps to a device, a computer, a list
// or a settings page.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp, type SettingsPage } from "../lib/app";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { BatteryCharging, BatteryLow, DeviceIcon, Devices, Gear, Monitor, Search } from "./icons";

interface Result {
  key: string;
  section: StringKey;
  title: string;
  extra?: string;
  icon: ReactNode;
  run: () => void;
}

const SETTINGS: { id: SettingsPage; label: StringKey }[] = [
  { id: "profile", label: "profile" },
  { id: "preferences", label: "preferences" },
  { id: "thisComputer", label: "thisComputer" },
  { id: "security", label: "security" },
  { id: "data", label: "data" },
  { id: "computers", label: "computers" },
  { id: "shortcuts", label: "shortcuts" },
  { id: "about", label: "about" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const { overview, openDevice, openSettings, navigate, setQuery: setFilters } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = norm(query.trim());

  const results = useMemo(() => {
    const keep = (...texts: string[]) => !q || texts.some((s) => norm(s).includes(q));
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const out: Result[] = [];
    const lists: [StringKey, ReactNode, () => void][] = [
      ["allDevices", <Devices size={16} />, () => navigate({ name: "devices" })],
      ["lowBattery", <BatteryLow size={16} />, () => (navigate({ name: "devices" }), setFilters({ filter: "low" }, true))],
      ["charging", <BatteryCharging size={16} />, () => (navigate({ name: "devices" }), setFilters({ filter: "charging" }, true))],
    ];
    if (q) for (const [label, icon, run] of lists) if (keep(t(label))) out.push({ key: `page:${label}`, section: "pages", title: t(label), icon, run: done(run) });
    for (const d of (overview?.devices ?? []).filter((d) => keep(d.name, d.model, d.host?.name ?? "")).slice(0, q ? 20 : 8)) {
      out.push({
        key: `device:${d.id}`,
        section: "devices",
        title: d.name,
        extra: d.battery?.percent != null ? `${d.battery.percent}%` : d.model,
        icon: <DeviceIcon kind={d.kind} size={16} />,
        run: done(() => openDevice(d.id)),
      });
    }
    if (q) {
      for (const h of (overview?.hosts ?? []).filter((h) => keep(h.name))) {
        out.push({ key: `host:${h.id}`, section: "computers", title: h.name, extra: h.online ? t("online") : t("offline"), icon: <Monitor size={16} />, run: done(() => navigate({ name: "devices", host: h.id })) });
      }
      for (const s of SETTINGS.filter((s) => keep(t(s.label)))) {
        out.push({ key: `settings:${s.id}`, section: "settings", title: t(s.label), icon: <Gear size={16} />, run: done(() => openSettings(s.id)) });
      }
    }
    return out;
  }, [q, overview, t, openDevice, openSettings, navigate, setFilters, onClose]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection: StringKey | null = null;
  return (
    <div className="dialog-backdrop search-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-label={t("search")}>
        <div className="search-input-row">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") setActive((i) => Math.min(results.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && results[active]) results[active].run();
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {results.length === 0 && <p className="search-empty">{t("noResults")}</p>}
          {results.map((r, i) => {
            const header = r.section !== lastSection ? <div className="search-section">{t(r.section)}</div> : null;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header}
                <button className={`search-result${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onClick={r.run}>
                  <span className="search-result-icon">{r.icon}</span>
                  <span className="search-result-text">
                    <span className="search-result-title">{r.title}</span>
                  </span>
                  {r.extra && <span className="search-result-when">{r.extra}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
