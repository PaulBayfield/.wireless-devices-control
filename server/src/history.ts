// Battery history: the runs the agents sent, cut to a window, with the charging phases
// worked out the same way as the agent does (agent/src/api/services/history.py).

import { sql } from "./db.ts";

export type ChargeState = "discharging" | "charging" | "full" | "not charging" | "error" | "unknown";

interface Run {
  start: number;
  end: number;
  percent: number;
  state: ChargeState;
  millivolts: number | null;
}

/** A rise smaller than this, on a device that does not say whether it is charging, is a wobble, not a charge. */
const MIN_INFERRED_RISE = 2;

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export interface Phase {
  state: ChargeState;
  inferred: boolean;
  from: string;
  to: string;
  from_percent: number;
  to_percent: number;
}

/**
 * The charging phases behind a list of runs, oldest first. A device that reports its charging
 * state gets one phase per stretch in the same state; one that only reports a level (Bose) gets
 * its charges inferred from the level going up, marked `inferred`.
 */
export function phases(runs: Run[], maxGap: number): Phase[] {
  type Found = { state: ChargeState; inferred: boolean; start: number; end: number; from: number; to: number };
  const found: Found[] = [];
  let rising: Found | null = null;
  let previous: Run | null = null;

  for (const run of runs) {
    if (run.state !== "unknown") {
      const follows = previous !== null && run.start - previous.end <= maxGap;
      if (follows && previous!.state === run.state) {
        Object.assign(found[found.length - 1], { end: run.end, to: run.percent });
      } else {
        found.push({ state: run.state, inferred: false, start: run.start, end: run.end, from: run.percent, to: run.percent });
      }
    } else if (previous && previous.state === "unknown" && run.percent > previous.percent) {
      if (rising && rising.end === previous.start) {
        Object.assign(rising, { end: run.start, to: run.percent });
      } else {
        rising = { state: "charging", inferred: true, start: previous.end, end: run.start, from: previous.percent, to: run.percent };
        found.push(rising);
      }
    }
    previous = run;
  }

  return found
    .filter((p) => !p.inferred || p.to - p.from >= MIN_INFERRED_RISE)
    .map((p) => ({ state: p.state, inferred: p.inferred, from: iso(p.start), to: iso(p.end), from_percent: p.from, to_percent: p.to }));
}

/** The readings and charging phases of one device over a window, in the shape the agent's API used. */
export async function readHistory(deviceId: string, since: Date, until: Date, maxGap: number) {
  const rows = await sql<{ startedAt: Date; endedAt: Date; percent: number; state: ChargeState; millivolts: number | null }[]>`
    SELECT started_at, ended_at, percent, state, millivolts FROM battery_runs
    WHERE device_id = ${deviceId} AND ended_at >= ${since} AND started_at <= ${until}
    ORDER BY started_at`;
  const start = since.getTime();
  const runs: Run[] = rows.map((r) => ({
    start: Math.max(r.startedAt.getTime(), start),
    end: r.endedAt.getTime(),
    percent: r.percent,
    state: r.state,
    millivolts: r.millivolts,
  }));

  const gapMs = maxGap * 1000;
  return {
    since: iso(since.getTime()),
    until: iso(until.getTime()),
    readings: runs.map((run, i) => ({
      from: iso(run.start),
      to: iso(run.end),
      percent: run.percent,
      state: run.state,
      millivolts: run.millivolts,
      gap: i > 0 && run.start - runs[i - 1].end > gapMs,
    })),
    phases: phases(runs, gapMs),
  };
}

/** Seconds without a reading after which a device counts as away rather than steady. */
export const maxGap = (pollInterval: number) => Math.max(3 * pollInterval, 120);
