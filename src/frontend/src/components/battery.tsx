import type { Battery } from "@/lib/types";

import { BoltIcon } from "./icons";

/** Green above 30 %, amber above 10 %, red below -- as on the command line. */
export function batteryTone(percent: number | null): string {
  if (percent === null) return "bg-zinc-400";
  if (percent > 30) return "bg-emerald-500";
  if (percent > 10) return "bg-amber-500";
  return "bg-red-500";
}

const STATE_LABELS: Record<string, string> = {
  charging: "Charging",
  full: "Charged",
  "not charging": "Plugged in, not charging",
  error: "Battery error",
  discharging: "On battery",
};

export function BatteryGauge({ battery, stale = false }: { battery: Battery | null; stale?: boolean }) {
  const percent = battery?.percent ?? null;
  const charging = battery?.state === "charging";

  return (
    <div className={stale ? "opacity-50" : undefined}>
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1 text-3xl font-semibold tabular-nums">
          {percent === null ? "—" : `${percent}%`}
          {charging && <BoltIcon className="size-5 text-amber-500" />}
        </span>
        {battery && battery.state !== "unknown" && (
          <span className="text-xs text-muted">{STATE_LABELS[battery.state] ?? battery.state}</span>
        )}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-label="Battery"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          className={`h-full rounded-full transition-[width] ${batteryTone(percent)}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}
