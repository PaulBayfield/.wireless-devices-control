"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type PointerEvent } from "react";

import { loadHistory } from "@/app/actions/devices";
import type { BatteryHistory as History, ChargeState, HistoryPhase } from "@/lib/types";

import { STATE_LABELS } from "./battery";

const RANGES = [
  { hours: 24, label: "24 h" },
  { hours: 24 * 7, label: "7 d" },
  { hours: 24 * 30, label: "30 d" },
];

/** What the charger is doing, as a band behind the level. On battery gets none. */
const BANDS: Partial<Record<ChargeState, string>> = {
  charging: "fill-amber-500/20",
  full: "fill-emerald-500/20",
  "not charging": "fill-zinc-500/20",
  error: "fill-red-500/20",
};

const HEIGHT = 200;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 36 };
const HOUR = 3_600_000;
/** Hours between two time ticks, from which the first that fits is taken. */
const TICK_STEPS = [1, 2, 3, 4, 6, 12, 24, 48, 72, 120, 168, 240];

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const MOMENT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`;
}

/** Time ticks on local clock boundaries: hours within a day, midnights beyond. */
function timeTicks(since: number, until: number, most: number): { at: number; label: string }[] {
  const span = (until - since) / HOUR;
  const step = TICK_STEPS.find((hours) => span / hours <= most) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const start = new Date(since);
  start.setHours(0, 0, 0, 0);

  const ticks = [];
  for (let at = start.getTime(); at <= until; at += step * HOUR) {
    if (at < since) continue;
    const midnight = new Date(at).getHours() === 0;
    ticks.push({ at, label: step >= 24 || midnight ? DAY.format(at) : TIME.format(at) });
  }
  return ticks;
}

interface Point {
  from: number;
  to: number;
  percent: number;
  state: ChargeState;
  millivolts: number | null;
  gap: boolean;
}

function Chart({ history, width }: { history: History; width: number }) {
  // Which reading the pointer or the keyboard is on, and where along it.
  const [hover, setHover] = useState<{ index: number; at: number } | null>(null);

  const since = Date.parse(history.since);
  const until = Date.parse(history.until);
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;

  const x = (at: number) => MARGIN.left + ((at - since) / (until - since)) * plotWidth;
  const y = (percent: number) => MARGIN.top + (1 - percent / 100) * plotHeight;

  const points: Point[] = history.readings.map((reading) => ({
    ...reading,
    from: Date.parse(reading.from),
    to: Date.parse(reading.to),
  }));

  // One stroke per stretch the device was read through; a gap starts another.
  const stretches: Point[][] = [];
  for (const point of points) {
    if (point.gap || stretches.length === 0) stretches.push([]);
    stretches[stretches.length - 1].push(point);
  }
  const outline = (stretch: Point[]) =>
    stretch.map((p) => `${x(p.from).toFixed(1)},${y(p.percent).toFixed(1)} ${x(p.to).toFixed(1)},${y(p.percent).toFixed(1)}`).join(" L");

  const bands = history.phases.filter((phase) => BANDS[phase.state]);
  const last = points[points.length - 1];
  const hovered = hover && points[hover.index] ? { point: points[hover.index], at: hover.at } : null;

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const at = since + ((event.clientX - box.left - MARGIN.left) / plotWidth) * (until - since);
    // The reading under the pointer, else the one that ends or starts closest.
    let index = 0;
    let closest = Infinity;
    points.forEach((p, i) => {
      const distance = at < p.from ? p.from - at : at > p.to ? at - p.to : 0;
      if (distance < closest) {
        closest = distance;
        index = i;
      }
    });
    const p = points[index];
    setHover({ index, at: Math.min(Math.max(at, p.from), p.to) });
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === "Escape") return setHover(null);
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const from = hover?.index ?? points.length;
    const index = Math.min(Math.max(from + (event.key === "ArrowLeft" ? -1 : 1), 0), points.length - 1);
    setHover({ index, at: points[index].to });
  }

  return (
    <div className="relative">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Battery level from ${MOMENT.format(since)} to ${MOMENT.format(until)}. Left and right arrows step through the readings.`}
        tabIndex={0}
        className="block touch-pan-y overflow-visible rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        {bands.map((phase) => {
          const left = x(Date.parse(phase.from));
          return (
            <rect
              key={`${phase.from}-${phase.state}`}
              x={left}
              y={MARGIN.top}
              width={Math.max(x(Date.parse(phase.to)) - left, 2)}
              height={plotHeight}
              className={BANDS[phase.state]}
            />
          );
        })}

        {[0, 25, 50, 75, 100].map((percent) => (
          <line
            key={percent}
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1={y(percent)}
            y2={y(percent)}
            stroke="var(--border)"
          />
        ))}
        {[0, 50, 100].map((percent) => (
          <text
            key={percent}
            x={MARGIN.left - 8}
            y={y(percent)}
            dy="0.32em"
            textAnchor="end"
            className="fill-muted text-[10px] tabular-nums"
          >
            {percent}%
          </text>
        ))}
        {timeTicks(since, until, width < 480 ? 4 : 7).map((tick) => (
          <text key={tick.at} x={x(tick.at)} y={HEIGHT - 6} textAnchor="middle" className="fill-muted text-[10px]">
            {tick.label}
          </text>
        ))}

        {/* The device was away: join the two sides without claiming a level in between. */}
        {stretches.slice(1).map((stretch, i) => {
          const before = stretches[i][stretches[i].length - 1];
          return (
            <line
              key={stretch[0].from}
              x1={x(before.to)}
              y1={y(before.percent)}
              x2={x(stretch[0].from)}
              y2={y(stretch[0].percent)}
              stroke="var(--muted)"
              strokeDasharray="2 4"
              opacity={0.6}
            />
          );
        })}
        {stretches.map((stretch) => (
          <g key={stretch[0].from}>
            <path
              d={`M${outline(stretch)} L${x(stretch[stretch.length - 1].to).toFixed(1)},${baseline} L${x(stretch[0].from).toFixed(1)},${baseline} Z`}
              fill="var(--accent)"
              opacity={0.1}
            />
            <path
              d={`M${outline(stretch)}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {last && !hovered && (
          <circle cx={x(last.to)} cy={y(last.percent)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        )}

        {hovered && (
          <>
            <line x1={x(hovered.at)} x2={x(hovered.at)} y1={MARGIN.top} y2={baseline} stroke="var(--muted)" />
            <circle
              cx={x(hovered.at)}
              cy={y(hovered.point.percent)}
              r={4}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </>
        )}
      </svg>

      {hovered && (
        <div
          role="status"
          className="pointer-events-none absolute rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm"
          style={{
            top: MARGIN.top,
            ...(x(hovered.at) > width / 2 ? { right: width - x(hovered.at) + 10 } : { left: x(hovered.at) + 10 }),
          }}
        >
          <p className="text-sm font-semibold tabular-nums">{hovered.point.percent}%</p>
          {hovered.point.state !== "unknown" && <p>{STATE_LABELS[hovered.point.state] ?? hovered.point.state}</p>}
          {hovered.point.millivolts !== null && <p className="tabular-nums">{hovered.point.millivolts} mV</p>}
          <p className="text-muted">{MOMENT.format(hovered.at)}</p>
        </div>
      )}
    </div>
  );
}

function Legend({ history }: { history: History }) {
  const states = (Object.keys(BANDS) as ChargeState[]).filter((state) =>
    history.phases.some((phase) => phase.state === state),
  );
  const away = history.readings.some((reading) => reading.gap);
  if (states.length === 0 && !away) return null;

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {states.map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <svg width={12} height={12} aria-hidden="true">
            <rect width={12} height={12} rx={2} className={BANDS[state]} />
          </svg>
          {STATE_LABELS[state] ?? state}
        </li>
      ))}
      {away && (
        <li className="flex items-center gap-1.5">
          <svg width={16} height={12} aria-hidden="true">
            <line x1={0} x2={16} y1={6} y2={6} stroke="var(--muted)" strokeDasharray="2 4" />
          </svg>
          Not read (off, asleep or away)
        </li>
      )}
    </ul>
  );
}

/** The charges in the window, latest first: the chart's bands, in words. */
function Charges({ phases }: { phases: HistoryPhase[] }) {
  const charges = phases.filter((phase) => phase.state === "charging").reverse();
  if (charges.length === 0) return null;
  const inferred = charges.some((phase) => phase.inferred);

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="text-xs font-medium">Charges</h3>
      <ul className="mt-2 space-y-1.5">
        {charges.slice(0, 5).map((phase) => (
          <li key={phase.from} className="flex justify-between gap-4 text-sm">
            <span className="text-muted">{MOMENT.format(Date.parse(phase.from))}</span>
            <span className="tabular-nums">
              {phase.from_percent}% → {phase.to_percent}%
              <span className="text-muted">
                {" "}
                in {phase.inferred ? "at most " : ""}
                {duration(Date.parse(phase.to) - Date.parse(phase.from))}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {charges.length > 5 && <p className="mt-2 text-xs text-muted">And {charges.length - 5} earlier.</p>}
      {inferred && (
        <p className="mt-2 text-xs text-muted">
          This device does not say when it is charging, so charges are deduced from its level going up, between the
          last reading before and the first one after.
        </p>
      )}
    </div>
  );
}

/**
 * How the battery level evolved, with the charging phases behind it.
 *
 * Starts from the history the page read on the server, and fetches another
 * range itself: re-rendering the page would re-read every setting over
 * Bluetooth for nothing.
 */
export function BatteryHistory({ id, initial, error: initialError }: { id: string; initial: History | null; error?: string | null }) {
  const [hours, setHours] = useState(RANGES[0].hours);
  const [history, setHistory] = useState(initial);
  const [error, setError] = useState(initialError ?? null);
  const [pending, startTransition] = useTransition();

  // Measured on the client, which also keeps every local time out of the server render.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function pick(next: number) {
    setHours(next);
    startTransition(async () => {
      const result = await loadHistory(id, next);
      if (result.ok && result.data) {
        setHistory(result.data);
        setError(null);
      } else {
        setError(result.ok ? "Could not read the battery history." : result.error);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium">Battery history</h2>
        <div className="flex gap-1" role="group" aria-label="Period">
          {RANGES.map((range) => (
            <button
              key={range.hours}
              type="button"
              aria-pressed={range.hours === hours}
              disabled={pending}
              onClick={() => pick(range.hours)}
              className={`rounded-lg border px-2.5 py-1 text-xs tabular-nums ${range.hours === hours ? "border-accent text-foreground" : "border-border text-muted hover:text-foreground"}`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

      <div ref={frame} className={`mt-4 transition-opacity ${pending ? "opacity-50" : ""}`} style={{ minHeight: HEIGHT }}>
        {width === null || !history ? null : history.readings.length === 0 ? (
          <p className="flex items-center justify-center text-sm text-muted" style={{ height: HEIGHT }}>
            No reading in this period. One is recorded at every poll, while the API runs and the device is reachable.
          </p>
        ) : (
          <>
            <Chart history={history} width={width} />
            <Legend history={history} />
            <Charges phases={history.phases} />
          </>
        )}
      </div>
    </section>
  );
}
