"use client";

import { useState } from "react";

import type { Settings } from "@/lib/types";

import { Button, Section, Select, Slider } from "./primitives";
import { useDevice } from "./use-device";

/** The form's starting point for a zone: what it shows now, where known. */
function ledForm(settings: Settings, zone: string) {
  const light = settings.led?.current?.[zone === "all" ? "primary" : zone];
  const effects = settings.led?.effects ?? [];
  return {
    zone,
    effect: light && effects.includes(light.effect) ? light.effect : "static",
    color: light?.color ? `#${light.color}` : "#ffffff",
  };
}

const LIGHTING_HINTS = {
  profile: "Showing the lighting stored in the onboard profile, which drives the LEDs in onboard mode.",
  "last set": "Showing what was last set from here: the mouse cannot report its lighting.",
  mixed: "Showing what was last set from here, and the onboard profile's lighting for the other zone.",
};

export function LogitechControls({ id }: { id: string }) {
  const { settings, save, pending, error } = useDevice(id);
  const [led, setLed] = useState(() => ledForm(settings, settings.led?.zones[0] ?? "all"));
  const hostMode = settings.onboard_mode?.value === "host";

  return (
    <div className="space-y-4">
      {error && (
        <p role="status" className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title="Sensor"
          hint={hostMode ? "In host mode, G HUB may overwrite these if it is running." : undefined}
        >
          {settings.dpi && (
            <Slider
              label="DPI"
              value={settings.dpi.value}
              min={settings.dpi.min}
              max={settings.dpi.max}
              step={settings.dpi.step}
              onCommit={(dpi) => save({ dpi })}
            />
          )}
          {settings.report_rate && (
            <Select
              label="Report rate"
              value={settings.report_rate.value}
              disabled={pending || !hostMode}
              options={settings.report_rate.supported.map((hz) => ({ value: hz, label: `${hz} Hz` }))}
              onChange={(report_rate) => save({ report_rate })}
            />
          )}
          {settings.onboard_mode && (
            <Select
              label="Profile mode"
              value={settings.onboard_mode.value}
              disabled={pending}
              options={settings.onboard_mode.modes.map((mode) => ({ value: mode, label: mode }))}
              onChange={(onboard_mode) => save({ onboard_mode })}
            />
          )}
          {!hostMode && (
            <p className="text-xs text-muted">
              The report rate belongs to the onboard profile: switch to host mode to change it.
            </p>
          )}
        </Section>

        {settings.led && (
          <Section
            title="Lighting"
            hint={
              settings.led.source
                ? LIGHTING_HINTS[settings.led.source]
                : "The current lighting is unknown until it is set from here."
            }
          >
            <Select
              label="Zone"
              value={led.zone}
              options={settings.led.zones.map((zone) => ({ value: zone, label: zone }))}
              onChange={(zone) => setLed(ledForm(settings, zone))}
            />
            <Select
              label="Effect"
              value={led.effect}
              options={settings.led.effects.map((effect) => ({ value: effect, label: effect }))}
              onChange={(effect) => setLed({ ...led, effect })}
            />
            {led.effect !== "off" && led.effect !== "cycle" && (
              <label className="flex items-center justify-between text-sm">
                <span>Colour</span>
                <input
                  type="color"
                  value={led.color}
                  onChange={(event) => setLed({ ...led, color: event.target.value })}
                  className="h-8 w-14 cursor-pointer rounded border border-border bg-background"
                />
              </label>
            )}
            <Button
              disabled={pending}
              onClick={() =>
                save({ led: { zone: led.zone, effect: led.effect, color: led.color.replace("#", "") } })
              }
            >
              Apply lighting
            </Button>
          </Section>
        )}
      </div>
    </div>
  );
}
