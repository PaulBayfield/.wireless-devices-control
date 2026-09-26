import { DeviceCard } from "@/components/device-card";
import { AutoRefresh, RefreshButton } from "@/components/refresh";
import { TimeAgo } from "@/components/time-ago";
import { ApiError, getDevices } from "@/lib/api";
import { verifySession } from "@/lib/dal";
import type { DevicesList } from "@/lib/types";

/** How often the open dashboard re-reads the API's in-memory state. */
const REFRESH_SECONDS = 30;

export default async function DashboardPage() {
  await verifySession();

  let list: DevicesList | null = null;
  let error: string | null = null;
  try {
    list = await getDevices();
  } catch (e) {
    error = e instanceof ApiError ? e.message : "Could not load the devices.";
  }

  // Lowest battery first among the connected ones: what needs charging.
  const devices = [...(list?.devices ?? [])].sort(
    (a, b) =>
      Number(b.connected) - Number(a.connected) ||
      (a.battery?.percent ?? 101) - (b.battery?.percent ?? 101),
  );

  return (
    <main>
      <AutoRefresh seconds={REFRESH_SECONDS} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Devices</h1>
          {list?.polled_at && (
            <p className="text-sm text-muted">
              Polled <TimeAgo iso={list.polled_at} />, every {list.poll_interval}s
            </p>
          )}
        </div>
        <RefreshButton />
      </div>

      {error ? (
        <p className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-500">{error}</p>
      ) : devices.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
          No device found yet. The first poll runs when the API starts.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </main>
  );
}
