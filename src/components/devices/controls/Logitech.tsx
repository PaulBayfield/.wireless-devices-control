import { useState } from "react";
import type { Settings } from "../../../lib/api";
import { useSettings } from "../../../lib/settings";
import { Button, Section, Select, Slider } from "./primitives";
import { useDevice } from "./useDevice";

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

const LIGHTING_HINTS = { profile: "lightingProfile", "last set": "lightingLastSet", mixed: "lightingMixed" } as const;

export function LogitechControls() {
  const { t } = useSettings();
  const { settings, save, pending, error } = useDevice();
  const [led, setLed] = useState(() => ledForm(settings, settings.led?.zones[0] ?? "all"));
  const hostMode = settings.onboard_mode?.value === "host";

  return (
    <>
      {error && (
        <p role="status" className="notice error">
          {error}
        </p>
      )}

      <div className="controls-grid">
        <Section title={t("sensor")} hint={hostMode ? t("hostModeHint") : undefined}>
          {settings.dpi && (
            <Slider label="DPI" value={settings.dpi.value} min={settings.dpi.min} max={settings.dpi.max} step={settings.dpi.step} onCommit={(dpi) => void save({ dpi })} />
          )}
          {settings.report_rate && (
            <Select
              label={t("reportRate")}
              value={settings.report_rate.value}
              disabled={pending || !hostMode}
              options={settings.report_rate.supported.map((hz) => ({ value: hz, label: `${hz} Hz` }))}
              onChange={(report_rate) => void save({ report_rate })}
            />
          )}
          {settings.onboard_mode && (
            <Select
              label={t("profileMode")}
              value={settings.onboard_mode.value}
              disabled={pending}
              options={settings.onboard_mode.modes.map((mode) => ({ value: mode, label: mode }))}
              onChange={(onboard_mode) => void save({ onboard_mode })}
            />
          )}
          {!hostMode && <p className="small muted">{t("reportRateHint")}</p>}
        </Section>

        {settings.led && (
          <Section title={t("lighting")} hint={settings.led.source ? t(LIGHTING_HINTS[settings.led.source]) : t("lightingUnknown")}>
            <Select label={t("zone")} value={led.zone} options={settings.led.zones.map((zone) => ({ value: zone, label: zone }))} onChange={(zone) => setLed(ledForm(settings, zone))} />
            <Select label={t("effect")} value={led.effect} options={settings.led.effects.map((effect) => ({ value: effect, label: effect }))} onChange={(effect) => setLed({ ...led, effect })} />
            {led.effect !== "off" && led.effect !== "cycle" && (
              <label className="control control-row">
                <span>{t("colour")}</span>
                <input type="color" className="color-field" value={led.color} onChange={(event) => setLed({ ...led, color: event.target.value })} />
              </label>
            )}
            <div className="button-row">
              <Button disabled={pending} onClick={() => void save({ led: { zone: led.zone, effect: led.effect, color: led.color.replace("#", "") } })}>
                {t("applyLighting")}
              </Button>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
