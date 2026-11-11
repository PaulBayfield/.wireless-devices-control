// The side panel: the open device's details, or the computers and what needs charging.

import { useState, type ReactNode } from "react";
import { api, isTauri, type Device } from "../../lib/api";
import { useApp, isLow } from "../../lib/app";
import { useSettings } from "../../lib/settings";
import { ConfirmDialog } from "../common";
import { WindowControls } from "../Toolbar";
import { DeviceIcon, Monitor, PanelRight } from "../icons";
import { Sensitive } from "./controls/primitives";
import { StatusDot } from "./Battery";

export function DevicePanel({ device }: { device: Device | undefined }) {
  const { t } = useSettings();
  const { togglePanel } = useApp();
  return (
    <aside className="panel">
      <div className="panel-header" data-tauri-drag-region>
        <span className="panel-label" data-tauri-drag-region>
          {device ? t("details") : t("overview")}
        </span>
        <div className="toolbar-spacer" data-tauri-drag-region />
        <button className="icon-button small" title={`${t("togglePanel")} (.)`} aria-label={t("togglePanel")} onClick={togglePanel}>
          <PanelRight />
        </button>
        {isTauri && <WindowControls />}
      </div>
      <div className="panel-body">{device ? <Details device={device} /> : <Summary />}</div>
    </aside>
  );
}

function Details({ device }: { device: Device }) {
  const { t, f } = useSettings();
  const { me, navigate } = useApp();
  const rows: [string, ReactNode][] = [
    [t("model"), device.model],
    [t("computer"), device.host ? <button className="link-button" onClick={() => navigate({ name: "devices", host: device.host!.id })}>{device.host.name}</button> : "—"],
    [t("battery"), device.battery?.percent != null ? `${device.battery.percent}%${device.battery.millivolts ? ` · ${device.battery.millivolts} mV` : ""}` : "—"],
    [t("lastSeenLabel"), device.last_seen_at ? f.moment(device.last_seen_at) : "—"],
    [t("firstSeen"), device.first_seen_at ? f.mediumDate(device.first_seen_at) : "—"],
  ];
  return (
    <>
      <div className="panel-section">
        {rows.map(([label, value]) => (
          <div key={label} className="panel-row">
            <span className="muted">{label}</span>
            <span>{value}</span>
          </div>
        ))}
        {device.address && (
          <div className="panel-row">
            <span className="muted">{t("address")}</span>
            <span className="mono">
              <Sensitive>{device.address}</Sensitive>
            </span>
          </div>
        )}
        <div className="panel-row">
          <span className="muted">{t("deviceId")}</span>
          <span className="mono small">{device.id}</span>
        </div>
      </div>
      {device.error && (
        <div className="panel-section">
          <p className="error-text">{device.error}</p>
        </div>
      )}
      {me.role === "admin" && !me.readOnly && <Forget device={device} />}
    </>
  );
}

function Forget({ device }: { device: Device }) {
  const { t } = useSettings();
  const { openDevice, reloadOverview } = useApp();
  return (
    <div className="panel-section">
      <ForgetButton
        name={device.name}
        onConfirm={async () => {
          await api(`/app/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
          openDevice(null);
          reloadOverview();
        }}
        label={t("forget")}
      />
    </div>
  );
}

function ForgetButton({ name, label, onConfirm }: { name: string; label: string; onConfirm: () => Promise<void> }) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-button danger" onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <ConfirmDialog title={label} text={t("forgetText", { name })} action={t("delete")} onConfirm={onConfirm} onClose={() => setOpen(false)} />}
    </>
  );
}

function Summary() {
  const { t, f } = useSettings();
  const { overview, navigate, openDevice } = useApp();
  if (!overview) return null;
  const low = overview.devices.filter((d) => isLow(d)).sort((a, b) => (a.battery?.percent ?? 0) - (b.battery?.percent ?? 0));

  return (
    <>
      <div className="panel-section">
        <span className="panel-subtitle">{t("computers")}</span>
        {overview.hosts.map((h) => (
          <button key={h.id} className="panel-item" onClick={() => navigate({ name: "devices", host: h.id })}>
            <Monitor />
            <span className="panel-item-text">
              <span>{h.name}</span>
              <span className="small muted">{h.last_seen_at ? t("lastReport", { when: f.relative(h.last_seen_at, t) }) : t("neverReported")}</span>
            </span>
            <StatusDot on={h.online} title={h.online ? t("online") : t("offline")} />
          </button>
        ))}
      </div>
      {low.length > 0 && (
        <div className="panel-section">
          <span className="panel-subtitle">{t("lowBattery")}</span>
          {low.map((d) => (
            <button key={d.id} className="panel-item" onClick={() => openDevice(d.id)}>
              <DeviceIcon kind={d.kind} />
              <span className="panel-item-text">
                <span>{d.name}</span>
                <span className="small muted">{d.host?.name}</span>
              </span>
              <span className="tabular bad-text">{d.battery?.percent}%</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
