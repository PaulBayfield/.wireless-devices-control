import { useEffect, useState } from "react";
import type { Battery, ChargeState, Device } from "../../lib/api";
import { useApp } from "../../lib/app";
import { useSettings } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { Bolt, DeviceIcon } from "../icons";

/** Green above 30 %, amber above 10 %, red below: as on the agent's command line. */
export function batteryTone(percent: number | null): "good" | "warn" | "bad" | "none" {
  if (percent === null) return "none";
  if (percent > 30) return "good";
  if (percent > 10) return "warn";
  return "bad";
}

export const stateLabel = (state: ChargeState): StringKey | null =>
  state === "unknown" ? null : (`state_${state}` as StringKey);

export function BatteryGauge({ battery, stale = false, large = false }: { battery: Battery | null; stale?: boolean; large?: boolean }) {
  const { t } = useSettings();
  const percent = battery?.percent ?? null;
  const charging = battery?.state === "charging";
  const label = battery ? stateLabel(battery.state) : null;

  return (
    <div className={`gauge${stale ? " stale" : ""}${large ? " large" : ""}`}>
      <div className="gauge-head">
        <span className="gauge-value tabular">
          {percent === null ? "—" : `${percent}%`}
          {charging && (
            <span className="gauge-bolt">
              <Bolt size={large ? 20 : 18} />
            </span>
          )}
        </span>
        {label && <span className="small muted">{t(label)}</span>}
      </div>
      <div className="gauge-track" role="meter" aria-label={t("battery")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <div className={`gauge-fill ${batteryTone(percent)}`} style={{ width: `${percent ?? 0}%` }} />
      </div>
    </div>
  );
}

/** "3 min ago", ticking on its own. */
export function TimeAgo({ iso }: { iso: string }) {
  const { t, f } = useSettings();
  const [, setNow] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <time dateTime={iso} title={f.moment(iso)}>
      {f.relative(iso, t)}
    </time>
  );
}

export function StatusDot({ on, title }: { on: boolean; title?: string }) {
  return <span className={`status-dot${on ? " on" : ""}`} title={title} />;
}

/** One device on the dashboard: the same card as before, on the shared look. */
export function DeviceCard({ device }: { device: Device }) {
  const { t, f } = useSettings();
  const { openDevice } = useApp();
  const status = device.connected ? t("connected") : device.host && !device.host.online ? t("offlineComputer", { name: device.host.name }) : t("notConnected");

  return (
    <button className="device-card" onClick={() => openDevice(device.id)}>
      <div className="device-card-head">
        <span className="device-card-icon">
          <DeviceIcon kind={device.kind} size={22} />
        </span>
        <div className="device-card-title">
          <span className="device-card-name">{device.name}</span>
          <span className="small muted">{device.model}</span>
        </div>
        <StatusDot on={device.connected} title={status} />
      </div>

      <BatteryGauge battery={device.battery} stale={!device.connected} />

      <div className="device-card-foot small muted">
        {device.error ? (
          <span className="error-text">{device.error}</span>
        ) : device.battery_updated_at ? (
          <span title={f.moment(device.battery_updated_at)}>{t(device.connected ? "updated" : "lastSeen", { when: f.relative(device.battery_updated_at, t) })}</span>
        ) : (
          <span>{device.connected ? t("waitingFirstReading") : t("notConnected")}</span>
        )}
        {device.host && <span className="device-card-host">{device.host.name}</span>}
      </div>
    </button>
  );
}
