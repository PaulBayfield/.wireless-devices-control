import Link from "next/link";
import { notFound } from "next/navigation";

import { BatteryGauge } from "@/components/battery";
import { BoseControls } from "@/components/controls/bose";
import { LogitechControls } from "@/components/controls/logitech";
import { Sensitive } from "@/components/controls/primitives";
import { ChevronLeftIcon, DeviceIcon } from "@/components/icons";
import { TimeAgo } from "@/components/time-ago";
import { ApiError, getDevice, getSettings } from "@/lib/api";
import { verifySession } from "@/lib/dal";
import type { Settings } from "@/lib/types";

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
  let settings: Settings | null = null;
  let settingsError: string | null = null;
  if (device.connected) {
    try {
      settings = await getSettings(id);
    } catch (error) {
      settingsError = error instanceof ApiError ? error.message : "Could not read the settings.";
    }
  }

  return (
    <main>
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ChevronLeftIcon className="size-4" />
        Devices
      </Link>

      <div className="mb-6 grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="flex items-center gap-4">
          <DeviceIcon kind={device.kind} className="size-10 text-accent" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{device.name}</h1>
            <p className="text-sm text-muted">
              {device.model} · <Sensitive>{device.address}</Sensitive> ·{" "}
              <span className={device.connected ? "text-emerald-600" : undefined}>
                {device.connected ? "connected" : "not connected"}
              </span>
            </p>
          </div>
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
        <BoseControls id={id} initial={settings} />
      ) : device.vendor === "logitech" ? (
        <LogitechControls id={id} initial={settings} />
      ) : null}
    </main>
  );
}
