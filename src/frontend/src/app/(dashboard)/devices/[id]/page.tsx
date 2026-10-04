import Link from "next/link";
import { notFound } from "next/navigation";

import { BatteryGauge } from "@/components/battery";
import { BatteryHistory } from "@/components/battery-history";
import { DeviceVisual } from "@/components/device-visual";
import { BoseControls } from "@/components/controls/bose";
import { DeviceSettingsProvider } from "@/components/controls/device-context";
import { LogitechControls } from "@/components/controls/logitech";
import { Sensitive } from "@/components/controls/primitives";
import { ChevronLeftIcon, DeviceIcon } from "@/components/icons";
import { TimeAgo } from "@/components/time-ago";
import { ApiError, getDevice, getHistory, getSettings } from "@/lib/api";
import { verifySession } from "@/lib/dal";
import type { BatteryHistory as History, Settings } from "@/lib/types";

export default async function DevicePage({ params }: PageProps<"/devices/[id]">) {
  await verifySession();
  const { id } = await params;

  let device;
  try {
    device = await getDevice(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // Read live from the device; a device that is away has no settings to show.
  // The history comes from the API's disk, so it is there whether the device is or not.
  const [settingsRead, historyRead] = await Promise.allSettled([
    device.connected ? getSettings(id) : null,
    getHistory(id, 24),
  ]);
  const failed = (reason: unknown, fallback: string) => (reason instanceof ApiError ? reason.message : fallback);

  const settings: Settings | null = settingsRead.status === "fulfilled" ? settingsRead.value : null;
  const settingsError =
    settingsRead.status === "rejected" ? failed(settingsRead.reason, "Could not read the settings.") : null;
  const history: History | null = historyRead.status === "fulfilled" ? historyRead.value : null;
  const historyError =
    historyRead.status === "rejected" ? failed(historyRead.reason, "Could not read the battery history.") : null;

  return (
    <DeviceSettingsProvider initial={settings}>
      <main>
        <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ChevronLeftIcon className="size-4" />
          Devices
        </Link>

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0 rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <DeviceIcon kind={device.kind} className="size-5 shrink-0 text-accent" />
                <h1 className="truncate text-xl font-semibold">{device.name}</h1>
              </div>
              <p className="mt-1 text-sm text-muted">{device.model}</p>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <span className={`size-2 rounded-full ${device.connected ? "bg-emerald-500" : "bg-zinc-400"}`} />
                {device.connected ? "Connected" : "Not connected"}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface p-4">
              <BatteryGauge battery={device.battery} stale={!device.connected} />
              {device.battery_updated_at && (
                <p className="mt-2 text-xs text-muted">
                  Read <TimeAgo iso={device.battery_updated_at} />
                </p>
              )}
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <DeviceVisual
              modelKey={device.key}
              kind={device.kind}
              name={device.model}
              battery={device.battery?.percent}
            />
          </div>
        </div>

        <div className="mb-6">
          <BatteryHistory id={id} initial={history} error={historyError} />
        </div>

        {!device.connected ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
            {device.name} is not connected, so its settings cannot be read. Turn it on and connect it to the device
            host{device.vendor === "bose" ? " (disconnect it from your phone first)" : ""}.
          </p>
        ) : settingsError || !settings ? (
          <p className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-500">
            {settingsError}
          </p>
        ) : device.vendor === "bose" ? (
          <BoseControls id={id} />
        ) : device.vendor === "logitech" ? (
          <LogitechControls id={id} />
        ) : device.vendor === "phonelink" ? (
          <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
            {settings.info?.model ? `${settings.info.model}, read` : "Read"} through Phone Link on the device host.
            There is nothing to change from here.
          </p>
        ) : null}
      </main>
    </DeviceSettingsProvider>
  );
}
