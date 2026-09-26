import Link from "next/link";

import type { Device } from "@/lib/types";

import { BatteryGauge } from "./battery";
import { DeviceIcon } from "./icons";
import { TimeAgo } from "./time-ago";

export function DeviceCard({ device }: { device: Device }) {
  return (
    <Link
      href={`/devices/${device.id}`}
      className="group block rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-accent"
    >
      <div className="flex items-start gap-3">
        <DeviceIcon kind={device.kind} className="mt-0.5 size-6 shrink-0 text-muted group-hover:text-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{device.name}</h2>
          <p className="truncate text-xs text-muted">{device.model}</p>
        </div>
        <span
          className={`mt-1.5 size-2 shrink-0 rounded-full ${device.connected ? "bg-emerald-500" : "bg-zinc-400"}`}
          title={device.connected ? "Connected" : "Not connected"}
        />
      </div>

      <div className="mt-5">
        <BatteryGauge battery={device.battery} stale={!device.connected} />
      </div>

      <p className="mt-3 text-xs text-muted">
        {device.error ? (
          <span className="text-red-500">{device.error}</span>
        ) : device.battery_updated_at ? (
          <>
            {device.connected ? "Updated " : "Last seen "}
            <TimeAgo iso={device.battery_updated_at} />
          </>
        ) : device.connected ? (
          "Waiting for the first reading"
        ) : (
          "Not connected"
        )}
      </p>
    </Link>
  );
}
