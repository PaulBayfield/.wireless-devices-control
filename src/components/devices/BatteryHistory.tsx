import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { BatteryHistory as History, ChargeState, HistoryPhase } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { Formats } from "../../lib/i18n";
import { stateLabel } from "./Battery";

const RANGES = [
  { hours: 24, label: "24 h" },
  { hours: 24 * 7, label: "7 d" },
  { hours: 24 * 30, label: "30 d" },
  { hours: 24 * 90, label: "90 d" },
];

/** What the charger is doing, as a band behind the level. On battery gets none. */
const BANDS: Partial<Record<ChargeState, string>> = {
  charging: "band-charging",
  full: "band-full",
  "not charging": "band-idle",
  error: "band-error",
};

const HEIGHT = 200;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 36 };
const HOUR = 3_600_000;
/** Hours between two time ticks, from which the first that fits is taken. */
const TICK_STEPS = [1, 2, 3, 4, 6, 12, 24, 48, 72, 120, 168, 240, 336, 720];

/** Time ticks on local clock boundaries: hours within a day, midnights beyond. */
function timeTicks(since: number, until: number, most: number, f: Formats): { at: number; label: string }[] {
  const span = (until - since) / HOUR;
  const step = TICK_STEPS.find((hours) => span / hours <= most) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const start = new Date(since);
  start.setHours(0, 0, 0, 0);
  const ticks = [];
  for (let at = start.getTime(); at <= until; at += step * HOUR) {
    if (at < since) continue;
    const midnight = new Date(at).getHours() === 0;
    ticks.push({ at, label: step >= 24 || midnight ? f.day(at) : f.time(at) });
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
  const { t, f } = useSettings();
  // Which reading the pointer or the keyboard is on, and where along it.
  const [hover, setHover] = useState<{ index: number; at: number } | null>(null);

  const since = Date.parse(history.since);
  const until = Date.parse(history.until);
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotHeight;

  const x = (at: number) => MARGIN.left + ((at - since) / (until - since)) * plotWidth;
  const y = (percent: number) => MARGIN.top + (1 - percent / 100) * plotHeight;

  const points: Point[] = history.readings.map((reading) => ({ ...reading, from: Date.parse(reading.from), to: Date.parse(reading.to) }));

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

  const hoveredLabel = hovered ? stateLabel(hovered.point.state) : null;

  return (
    <div className="chart">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={t("chartLabel", { from: f.moment(since), to: f.moment(until) })}
        tabIndex={0}
        className="chart-svg"
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
          <line key={percent} x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(percent)} y2={y(percent)} className="chart-grid" />
        ))}
        {[0, 50, 100].map((percent) => (
          <text key={percent} x={MARGIN.left - 8} y={y(percent)} dy="0.32em" textAnchor="end" className="chart-label">
            {percent}%
          </text>
        ))}
        {timeTicks(since, until, width < 480 ? 4 : 7, f).map((tick) => (
          <text key={tick.at} x={x(tick.at)} y={HEIGHT - 6} textAnchor="middle" className="chart-label">
            {tick.label}
          </text>
        ))}

        {/* The device was away: join the two sides without claiming a level in between. */}
        {stretches.slice(1).map((stretch, i) => {
          const before = stretches[i][stretches[i].length - 1];
          return <line key={stretch[0].from} x1={x(before.to)} y1={y(before.percent)} x2={x(stretch[0].from)} y2={y(stretch[0].percent)} className="chart-away" />;
        })}
        {stretches.map((stretch) => (
          <g key={stretch[0].from}>
            <path
              d={`M${outline(stretch)} L${x(stretch[stretch.length - 1].to).toFixed(1)},${baseline} L${x(stretch[0].from).toFixed(1)},${baseline} Z`}
              className="chart-area"
            />
            <path d={`M${outline(stretch)}`} className="chart-line" />
          </g>
        ))}
        {last && !hovered && <circle cx={x(last.to)} cy={y(last.percent)} r={4} className="chart-dot" />}

        {hovered && (
          <>
            <line x1={x(hovered.at)} x2={x(hovered.at)} y1={MARGIN.top} y2={baseline} className="chart-cursor" />
            <circle cx={x(hovered.at)} cy={y(hovered.point.percent)} r={4} className="chart-dot" />
          </>
        )}
      </svg>

      {hovered && (
        <div
          role="status"
          className="chart-tooltip"
          style={{ top: MARGIN.top, ...(x(hovered.at) > width / 2 ? { right: width - x(hovered.at) + 10 } : { left: x(hovered.at) + 10 }) }}
        >
          <strong className="tabular">{hovered.point.percent}%</strong>
          {hoveredLabel && <span>{t(hoveredLabel)}</span>}
          {hovered.point.millivolts !== null && <span className="tabular">{hovered.point.millivolts} mV</span>}
          <span className="muted">{f.moment(hovered.at)}</span>
        </div>
      )}
    </div>
  );
}

function Legend({ history }: { history: History }) {
  const { t } = useSettings();
  const states = (Object.keys(BANDS) as ChargeState[]).filter((state) => history.phases.some((phase) => phase.state === state));
  const away = history.readings.some((reading) => reading.gap);
  if (states.length === 0 && !away) return null;

  return (
    <ul className="chart-legend small muted">
      {states.map((state) => (
        <li key={state}>
          <svg width={12} height={12} aria-hidden="true">
            <rect width={12} height={12} rx={2} className={BANDS[state]} />
          </svg>
          {t(stateLabel(state)!)}
        </li>
      ))}
      {away && (
        <li>
          <svg width={16} height={12} aria-hidden="true">
            <line x1={0} x2={16} y1={6} y2={6} className="chart-away" />
          </svg>
          {t("notRead")}
        </li>
      )}
    </ul>
  );
}

/** The charges in the window, latest first: the chart's bands, in words. */
function Charges({ phases }: { phases: HistoryPhase[] }) {
  const { t, f } = useSettings();
  const charges = phases.filter((phase) => phase.state === "charging").reverse();
  if (charges.length === 0) return null;
  const inferred = charges.some((phase) => phase.inferred);

  return (
    <div className="charges">
      <h3 className="card-subtitle">{t("charges")}</h3>
      <ul>
        {charges.slice(0, 5).map((phase) => {
          const duration = f.duration(Date.parse(phase.to) - Date.parse(phase.from), t);
          return (
            <li key={phase.from}>
              <span className="muted">{f.moment(phase.from)}</span>
              <span className="tabular">
                {phase.from_percent}% → {phase.to_percent}%{" "}
                <span className="muted">{phase.inferred ? t("inAtMost", { duration }) : t("inDuration", { duration })}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {charges.length > 5 && <p className="small muted">{t("andEarlier", { n: charges.length - 5 })}</p>}
      {inferred && <p className="small muted">{t("inferredCharges")}</p>}
    </div>
  );
}

/** How the battery level evolved, with the charging phases behind it. Read from the server: there whether the device is or not. */
export function BatteryHistory({ id }: { id: string }) {
  const { t } = useSettings();
  const [hours, setHours] = useState(RANGES[0].hours);
  const { data: history, error, loading } = useApi<History>(`/app/devices/${encodeURIComponent(id)}/history?hours=${hours}`, true);

  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{t("batteryHistory")}</h2>
        <div className="segmented" role="group" aria-label={t("period")}>
          {RANGES.map((range) => (
            <button key={range.hours} className={range.hours === hours ? "active" : ""} aria-pressed={range.hours === hours} onClick={() => setHours(range.hours)}>
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div ref={frame} className={`chart-frame${loading && history ? " loading" : ""}`} style={{ minHeight: HEIGHT }}>
        {width === null || !history ? null : history.readings.length === 0 ? (
          <p className="chart-empty muted" style={{ height: HEIGHT }}>
            {t("noReading")}
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
