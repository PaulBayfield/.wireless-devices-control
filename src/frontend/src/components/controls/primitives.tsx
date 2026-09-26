"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/**
 * A slider that commits once the hand is off it: every move updates the
 * label, but the device is written only after `delay` ms without a change.
 * Follows `value` whenever the device reports a new one.
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
    <label className="block">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{format(local)}</span>
      </div>
      <input
        type="range"
        className="mt-1.5 w-full disabled:opacity-50"
        min={min}
        max={max}
        step={step}
        value={local}
        disabled={disabled}
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

export function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-border"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </button>
    </div>
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
    <label className="flex items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <select
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
        className="rounded-lg border border-border bg-background px-2 py-1.5 disabled:opacity-50"
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

export function Button({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  const tones = {
    default: "border-border hover:border-accent",
    danger: "border-red-500/40 text-red-500 hover:bg-red-500/10",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border bg-surface px-3 py-1.5 text-sm disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** A button that asks "sure?" on the first click and acts on the second. */
export function ConfirmButton({
  children,
  confirm,
  onConfirm,
  disabled,
}: {
  children: ReactNode;
  confirm: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      tone="danger"
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

/** Blurred until hovered or focused: identifiers that should not show on a screen share. */
export function Sensitive({ children }: { children: ReactNode }) {
  return (
    <span
      tabIndex={0}
      title="Hover to reveal"
      className="cursor-default blur-sm transition-[filter] duration-150 outline-none select-none hover:blur-none hover:select-auto focus:blur-none focus:select-auto"
    >
      {children}
    </span>
  );
}

export function Row({ label, value, sensitive = false }: { label: string; value: ReactNode; sensitive?: boolean }) {
  const shown = value ?? "—";
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted">{label}</span>
      <span className="truncate font-mono text-xs leading-5">
        {sensitive && value != null ? <Sensitive>{shown}</Sensitive> : shown}
      </span>
    </div>
  );
}
