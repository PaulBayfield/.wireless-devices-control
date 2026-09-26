"use client";

import { useState } from "react";

import { Button, ConfirmButton, Row, Section, Select, Sensitive, Slider, Toggle } from "./primitives";
import { useDevice } from "./use-device";

const TRANSPORT = [
  { action: "prev", label: "Previous" },
  { action: "play", label: "Play" },
  { action: "pause", label: "Pause" },
  { action: "next", label: "Next" },
];

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function BoseControls({ id }: { id: string }) {
  const { settings, save, act, pending, error, notice } = useDevice(id);
  const [name, setName] = useState(settings.name ?? "");
  const actions = new Set(settings.actions);

  const currentSlot = settings.mode?.modes.find((mode) => mode.slot === settings.mode?.current);
  const cncEditable = currentSlot?.editable ?? false;

  return (
    <div className="space-y-4">
      {(error || notice) && (
        <p
          role="status"
          className={`rounded-xl border p-3 text-sm ${error ? "border-red-500/30 bg-red-500/5 text-red-500" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"}`}
        >
          {error ?? notice}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {settings.volume && (
          <Section title="Sound">
            <Slider
              label="Volume"
              value={Math.min(settings.volume.level, settings.volume.safe_max)}
              min={0}
              max={Math.min(settings.volume.max, settings.volume.safe_max)}
              format={(v) => `${v} / ${settings.volume!.max}`}
              onCommit={(volume) => save({ volume })}
            />
            {settings.eq?.map((band) => (
              <Slider
                key={band.band}
                label={band.band[0].toUpperCase() + band.band.slice(1)}
                value={band.value}
                min={band.min}
                max={band.max}
                format={signed}
                onCommit={(value) => save({ eq: { [band.band]: value } })}
              />
            ))}
            <p className="text-xs text-muted">
              Volume stops at {settings.volume.safe_max} here: writes land instantly, and these get loud.
            </p>
          </Section>
        )}

        {(settings.cnc || settings.mode) && (
          <Section title="Noise cancellation">
            {settings.mode && (
              <Select
                label="Mode"
                value={settings.mode.current ?? -1}
                disabled={pending}
                options={settings.mode.modes
                  .filter((mode) => !mode.editable || mode.configured)
                  .map((mode) => ({ value: mode.slot, label: mode.name || `Slot ${mode.slot}` }))}
                onChange={(slot) => save({ mode: slot })}
              />
            )}
            {settings.cnc && settings.cnc.level !== null && (
              <Slider
                label="Cancellation"
                value={settings.cnc.max - settings.cnc.level}
                min={0}
                max={settings.cnc.max}
                format={(v) => (v === settings.cnc!.max ? "Max" : v === 0 ? "Off (aware)" : `${v} / ${settings.cnc!.max}`)}
                disabled={!cncEditable}
                onCommit={(value) => save({ cnc: settings.cnc!.max - value })}
              />
            )}
            {currentSlot && (
              <Toggle
                label="Wind block"
                checked={currentSlot.wind_block}
                disabled={pending || !cncEditable}
                onChange={(wind_block) => save({ wind_block })}
              />
            )}
            {!cncEditable && currentSlot && (
              <p className="text-xs text-muted">
                {currentSlot.name} is a factory preset: switch to one of your own modes to adjust it.
              </p>
            )}
          </Section>
        )}

        <Section title="Behaviour">
          {typeof settings.multipoint === "boolean" && (
            <Toggle
              label="Multipoint"
              checked={settings.multipoint}
              disabled={pending}
              onChange={(multipoint) => save({ multipoint })}
            />
          )}
          {settings.prompts && typeof settings.prompts.enabled === "boolean" && (
            <Toggle
              label={`Voice prompts${settings.prompts.language ? ` (${settings.prompts.language})` : ""}`}
              checked={settings.prompts.enabled}
              disabled={pending}
              onChange={(prompts) => save({ prompts })}
            />
          )}
          {settings.sidetone?.level && (
            <Select
              label="Sidetone"
              value={settings.sidetone.level}
              disabled={pending}
              options={settings.sidetone.levels.map((level) => ({ value: level, label: level }))}
              onChange={(sidetone) => save({ sidetone })}
            />
          )}
          {settings.standby_minutes != null && (
            <Row label="Auto-off" value={`${settings.standby_minutes} min`} />
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && name !== settings.name) save({ name: name.trim() });
            }}
          >
            <input
              value={name}
              maxLength={30}
              onChange={(event) => setName(event.target.value)}
              aria-label="Bluetooth name"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={pending || !name.trim() || name === settings.name}
              className="rounded-lg border border-border px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
            >
              Rename
            </button>
          </form>
        </Section>

        <Section title="Device">
          {TRANSPORT.some(({ action }) => actions.has(action)) && (
            <div className="flex flex-wrap gap-2">
              {TRANSPORT.filter(({ action }) => actions.has(action)).map(({ action, label }) => (
                <Button key={action} disabled={pending} onClick={() => act(action)}>
                  {label}
                </Button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {actions.has("pairing") && (
              <Button disabled={pending} onClick={() => act("pairing", { enabled: true }, "Pairing mode on.")}>
                Pairing mode
              </Button>
            )}
            {actions.has("power_off") && (
              <ConfirmButton
                disabled={pending}
                confirm="Click again to power off"
                onConfirm={() => act("power_off", {}, "Powered off.")}
              >
                Power off
              </ConfirmButton>
            )}
          </div>
          {settings.source && settings.source.kind !== "none" && (
            <Row
              label="Playing from"
              value={
                <>
                  {settings.source.kind}
                  {settings.source.address && (
                    <>
                      {" · "}
                      <Sensitive>{settings.source.address}</Sensitive>
                    </>
                  )}
                </>
              }
            />
          )}
          <Row label="Firmware" value={settings.info?.firmware} sensitive />
          <Row label="Serial" value={settings.info?.serial} sensitive />
          <Row label="MAC" value={settings.info?.mac} sensitive />
        </Section>
      </div>
    </div>
  );
}
