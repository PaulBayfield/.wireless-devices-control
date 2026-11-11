import { useApp } from "../../lib/app";
import { useSettings } from "../../lib/settings";
import { Monitor } from "../icons";
import { DeviceCard } from "./Battery";

/** Every device, as cards: the old home page, in the shared shell. */
export function Dashboard() {
  const { t, f } = useSettings();
  const { me, overview, visible, list, host, openSettings } = useApp();

  if (!overview) return null;

  const hosts = host ? [host] : overview.hosts;
  const polled = host ? host.polled_at : overview.polled_at;
  const interval = Math.min(...hosts.map((h) => h.poll_interval), Infinity);

  if (overview.hosts.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <Monitor size={32} />
          <h2>{t("noComputers")}</h2>
          <p className="muted">{t("noComputersHint")}</p>
          {me.role === "admin" && (
            <button className="primary-button" onClick={() => openSettings("computers")}>
              {t("addComputer")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <p className="page-subtitle muted">{polled ? t("polledAgo", { when: f.relative(polled, t), seconds: Number.isFinite(interval) ? interval : 30 }) : t("neverPolled")}</p>

      {visible.length === 0 ? (
        <div className="empty-state">
          <h2>{list === "low" ? t("noLowBattery") : list === "charging" ? t("noCharging") : t("noDevices")}</h2>
          {list === "all" && <p className="muted">{t("noDevicesHint")}</p>}
        </div>
      ) : (
        <div className="device-grid">
          {visible.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  );
}
