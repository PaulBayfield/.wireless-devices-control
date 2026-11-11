import { useState } from "react";
import { useSettings } from "../../../lib/settings";
import type { StringKey } from "../../../lib/i18n";
import { Button, ConfirmButton, Row, Section, Select, Sensitive, Slider, Toggle } from "./primitives";
import { useDevice } from "./useDevice";

const TRANSPORT: { action: string; label: StringKey }[] = [
  { action: "prev", label: "previous" },
  { action: "play", label: "play" },
  { action: "pause", label: "pause" },
  { action: "next", label: "next" },
];

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function BoseControls() {
  const { t } = useSettings();
  const { settings, save, act, pending, error, notice } = useDevice();
  const [name, setName] = useState(settings.name ?? "");
  const actions = new Set(settings.actions);

  const currentSlot = settings.mode?.modes.find((mode) => mode.slot === settings.mode?.current);
  const cncEditable = currentSlot?.editable ?? false;

  return (
    <>
      {(error || notice) && (
        <p role="status" className={`notice${error ? " error" : " good"}`}>
          {error ?? notice}
        </p>
      )}

      <div className="controls-grid">
        {settings.volume && (
          <Section title={t("sound")}>
            <Slider
              label={t("volume")}
              value={Math.min(settings.volume.level, settings.volume.safe_max)}
              min={0}
              max={Math.min(settings.volume.max, settings.volume.safe_max)}
              format={(v) => `${v} / ${settings.volume!.max}`}
              onCommit={(volume) => void save({ volume })}
            />
            {settings.eq?.map((band) => (
              <Slider
                key={band.band}
                label={band.band[0].toUpperCase() + band.band.slice(1)}
                value={band.value}
                min={band.min}
                max={band.max}
                format={signed}
                onCommit={(value) => void save({ eq: { [band.band]: value } })}
              />
            ))}
            <p className="small muted">{t("volumeHint", { max: settings.volume.safe_max })}</p>
          </Section>
        )}

        {(settings.cnc || settings.mode) && (
          <Section title={t("noiseCancellation")}>
            {settings.mode && (
              <Select
                label={t("mode")}
                value={settings.mode.current ?? -1}
                disabled={pending}
                options={settings.mode.modes
                  .filter((mode) => !mode.editable || mode.configured)
                  .map((mode) => ({ value: mode.slot, label: mode.name || t("slot", { n: mode.slot }) }))}
                onChange={(slot) => void save({ mode: slot })}
              />
            )}
            {settings.cnc && settings.cnc.level !== null && (
              <Slider
                label={t("cancellation")}
                value={settings.cnc.max - settings.cnc.level}
                min={0}
                max={settings.cnc.max}
                format={(v) => (v === settings.cnc!.max ? t("cncMax") : v === 0 ? t("cncOff") : `${v} / ${settings.cnc!.max}`)}
                disabled={!cncEditable}
                onCommit={(value) => void save({ cnc: settings.cnc!.max - value })}
              />
            )}
            {currentSlot && (
              <Toggle label={t("windBlock")} checked={currentSlot.wind_block} disabled={pending || !cncEditable} onChange={(wind_block) => void save({ wind_block })} />
            )}
            {!cncEditable && currentSlot && <p className="small muted">{t("factoryPreset", { name: currentSlot.name })}</p>}
          </Section>
        )}

        <Section title={t("behaviour")}>
          {typeof settings.multipoint === "boolean" && (
            <Toggle label={t("multipoint")} checked={settings.multipoint} disabled={pending} onChange={(multipoint) => void save({ multipoint })} />
          )}
          {settings.prompts && typeof settings.prompts.enabled === "boolean" && (
            <Toggle
              label={`${t("voicePrompts")}${settings.prompts.language ? ` (${settings.prompts.language})` : ""}`}
              checked={settings.prompts.enabled}
              disabled={pending}
              onChange={(prompts) => void save({ prompts })}
            />
          )}
          {settings.sidetone?.level && (
            <Select
              label={t("sidetone")}
              value={settings.sidetone.level}
              disabled={pending}
              options={settings.sidetone.levels.map((level) => ({ value: level, label: level }))}
              onChange={(sidetone) => void save({ sidetone })}
            />
          )}
          {settings.standby_minutes != null && <Row label={t("autoOff")} value={t("minutes", { n: settings.standby_minutes })} />}
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() && name !== settings.name) void save({ name: name.trim() });
            }}
          >
            <input className="text-field" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} aria-label={t("bluetoothName")} />
            <button type="submit" className="text-button outlined" disabled={pending || !name.trim() || name === settings.name}>
              {t("rename")}
            </button>
          </form>
        </Section>

        <Section title={t("device")}>
          {TRANSPORT.some(({ action }) => actions.has(action)) && (
            <div className="button-row">
              {TRANSPORT.filter(({ action }) => actions.has(action)).map(({ action, label }) => (
                <Button key={action} disabled={pending} onClick={() => void act(action)}>
                  {t(label)}
                </Button>
              ))}
            </div>
          )}
          <div className="button-row">
            {actions.has("pairing") && (
              <Button disabled={pending} onClick={() => void act("pairing", { enabled: true }, t("pairingOn"))}>
                {t("pairingMode")}
              </Button>
            )}
            {actions.has("power_off") && (
              <ConfirmButton disabled={pending} confirm={t("powerOffConfirm")} onConfirm={() => void act("power_off", {}, t("poweredOff"))}>
                {t("powerOff")}
              </ConfirmButton>
            )}
          </div>
          {settings.source && settings.source.kind !== "none" && (
            <Row
              label={t("playingFrom")}
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
          <Row label={t("firmware")} value={settings.info?.firmware} sensitive />
          <Row label={t("serial")} value={settings.info?.serial} sensitive />
          <Row label={t("mac")} value={settings.info?.mac} sensitive />
        </Section>
      </div>
    </>
  );
}
