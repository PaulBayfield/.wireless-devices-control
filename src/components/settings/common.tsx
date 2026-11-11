// Pieces shared by the settings pages (same layout as Calendar's and Notes' settings).

import { useState, type ReactNode } from "react";
import { api, serverUrl, type Me } from "../../lib/api";
import { openExternal } from "../../lib/desktop";
import { ExternalLink } from "../icons";
import { useApp } from "../../lib/app";
import { useSettings } from "../../lib/settings";
import { useToast } from "../common";

/** What an API key (the desktop app) can't do: a signed-in session on the web app can. */
export function WebOnly() {
  const { t } = useSettings();
  return (
    <div className="key-reveal">
      <p className="small">{t("webOnly")}</p>
      <button className="text-button" onClick={() => void openExternal(serverUrl())}>
        <ExternalLink size={14} />
        {t("openWebApp")}
      </button>
    </div>
  );
}

export function PageHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="settings-page-header">
      <h2>{title}</h2>
      {hint && <p className="small muted">{hint}</p>}
    </header>
  );
}

/** A setting: its name and explanation on the left, the control on the right. */
export function Row({ label, hint, children, disabled, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; disabled?: boolean; stack?: boolean }) {
  return (
    <div className={`setting-row${disabled ? " disabled" : ""}${stack ? " stack" : ""}`}>
      <div className="setting-text">
        <span>{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </div>
      {children !== undefined && <div className="setting-control">{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string }) {
  return <input type="checkbox" className="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

/** Saves a profile change and shows the result (or the error). */
export function useSaveProfile() {
  const { setMe } = useApp();
  const { t } = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown>, message = t("saved")) => {
    setBusy(true);
    try {
      setMe(await api<Me>("/app/profile", { method: "PATCH", body: patch }));
      toast(message);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy };
}
