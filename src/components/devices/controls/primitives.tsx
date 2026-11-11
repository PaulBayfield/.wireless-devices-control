import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../../../lib/settings";

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head column">
        <h2 className="card-title">{title}</h2>
        {hint && <p className="small muted">{hint}</p>}
      </div>
      <div className="controls">{children}</div>
    </section>
  );
}

/**
 * A slider that commits once the hand is off it: every move updates the label, but the device is
 * written only after `delay` ms without a change. Follows `value` whenever the device reports a new one.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  disabled,
  onCommit,
  delay = 350,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  disabled?: boolean;
  onCommit: (value: number) => void;
  delay?: number;
}) {
  const [local, setLocal] = useState(value);
  const [reported, setReported] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The device reported a new value: show it (adjusting state during render).
  if (value !== reported) {
    setReported(value);
    setLocal(value);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <label className="control slider">
      <span className="control-row">
        <span>{label}</span>
        <span className="tabular muted">{format(local)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
        style={{ "--fill": `${((local - min) / (max - min || 1)) * 100}%` } as React.CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          setLocal(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            if (next !== value) onCommit(next);
          }, delay);
        }}
      />
    </label>
  );
}

export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="control control-row">
      <span>{label}</span>
      <input type="checkbox" className="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className="control control-row">
      <span>{label}</span>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Button({ children, onClick, disabled, danger }: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className={`text-button outlined${danger ? " danger" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** A button that asks "sure?" on the first click and acts on the second. */
export function ConfirmButton({ children, confirm, onConfirm, disabled }: { children: ReactNode; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      danger
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirm : children}
    </Button>
  );
}

/** Blurred until hovered or focused (when the preference is on): identifiers that should not show on a screen share. */
export function Sensitive({ children }: { children: ReactNode }) {
  const { t } = useSettings();
  return (
    <span className="sensitive" tabIndex={0} title={t("revealHint")}>
      {children}
    </span>
  );
}

export function Row({ label, value, sensitive = false }: { label: string; value: ReactNode; sensitive?: boolean }) {
  const shown = value ?? "—";
  return (
    <div className="control control-row">
      <span className="muted">{label}</span>
      <span className="mono">{sensitive && value != null ? <Sensitive>{shown}</Sensitive> : shown}</span>
    </div>
  );
}
