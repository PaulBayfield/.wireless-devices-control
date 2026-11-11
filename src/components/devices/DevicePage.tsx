import { useEffect, useState } from "react";
import type { Device, Settings } from "../../lib/api";
import { readSettings } from "../../lib/agent";
import { useApp } from "../../lib/app";
import { useSettings } from "../../lib/settings";
import { Spinner } from "../common";
import { DeviceIcon } from "../icons";
import { BatteryGauge, StatusDot } from "./Battery";
import { BatteryHistory } from "./BatteryHistory";
import { DeviceVisual } from "./DeviceVisual";
import { BoseControls } from "./controls/Bose";
import { LogitechControls } from "./controls/Logitech";
import { DeviceSettingsContext } from "./controls/useDevice";

/** One device: the same page as before. Its data comes from the server; its settings from this computer's agent. */
export function DevicePage({ device }: { device: Device }) {
  const { t, f } = useSettings();
  const { local, isLocal, openSettings } = useApp();
  const here = isLocal(device.id);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  // Read live from the device, through the agent of this computer, when it has the device.
  const canRead = here && device.connected && !!local.agent;
  useEffect(() => {
    setSettings(null);
    setSettingsError(null);
    if (!canRead || !local.agent) return;
    let live = true;
    setReading(true);
    readSettings(local.agent, device.id).then(
      (s) => live && setSettings(s),
      (e: Error) => live && setSettingsError(e.message),
    ).finally(() => live && setReading(false));
    return () => {
      live = false;
    };
  }, [canRead, local.agent, device.id]);

  const status = device.connected ? t("connected") : device.host && !device.host.online ? t("offlineComputer", { name: device.host.name }) : t("notConnected");

  return (
    <div className="page device-page">
      <div className="device-top">
        <div className="device-top-main">
          <section className="card">
            <div className="device-title">
              <span className="device-title-icon">
                <DeviceIcon kind={device.kind} size={20} />
              </span>
              <h2>{device.name}</h2>
            </div>
            <p className="muted">{device.model}</p>
            <p className="device-status">
              <StatusDot on={device.connected} />
              {status}
              {device.host && device.connected && <span className="muted"> · {t("onComputer", { name: device.host.name })}</span>}
            </p>
          </section>
          <section className="card">
            <BatteryGauge battery={device.battery} stale={!device.connected} large />
            {device.battery_updated_at && (
              <p className="small muted gauge-when" title={f.moment(device.battery_updated_at)}>
                {t("readAt", { when: f.relative(device.battery_updated_at, t) })}
              </p>
            )}
          </section>
        </div>
        <section className="card visual-card">
          <DeviceVisual modelKey={device.key} kind={device.kind} name={device.model} battery={device.battery?.percent} lights={settings?.led?.current} />
        </section>
      </div>

      <BatteryHistory id={device.id} />

      {device.vendor === "phonelink" ? (
        <p className="card muted">{t("phoneLinkInfo", { model: settings?.info?.model ?? device.model, computer: device.host?.name ?? "?" })}</p>
      ) : !device.connected ? (
        <p className="card muted">
          {t("notConnectedSettings", { name: device.name })}
          {device.vendor === "bose" ? t("boseHint") : ""}
        </p>
      ) : !local.agent ? (
        <div className="card notice-card">
          <p>{t("agentNeeded")}</p>
          <button className="primary-button" onClick={() => openSettings("thisComputer")}>
            {t("setUpAgent")}
          </button>
        </div>
      ) : !here ? (
        <p className="card muted">{t("otherComputer", { name: device.host?.name ?? "?" })}</p>
      ) : settingsError ? (
        <p className="notice error">{settingsError}</p>
      ) : !settings ? (
        <p className="card muted reading">
          {reading && <Spinner />} {t("readingSettings")}
        </p>
      ) : (
        <DeviceSettingsContext.Provider value={{ id: device.id, agent: local.agent, settings, setSettings }}>
          {device.vendor === "bose" ? <BoseControls /> : device.vendor === "logitech" ? <LogitechControls /> : null}
        </DeviceSettingsContext.Provider>
      )}
    </div>
  );
}
