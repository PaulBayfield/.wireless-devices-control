// /link?challenge=…&name=…: opened by the desktop app to link its computer. A signed-in admin
// approves it here; the desktop app then picks up the computer's agent key on its own.

import { useState } from "react";
import { api } from "../../lib/api";
import { useApp } from "../../lib/app";
import { useSettings } from "../../lib/settings";
import { Monitor } from "../icons";

export function LinkPage() {
  const { t } = useSettings();
  const { me, query, reloadOverview } = useApp();
  const [state, setState] = useState<"ask" | "busy" | "done">("ask");
  const [error, setError] = useState<string | null>(null);
  const challenge = query.challenge ?? "";
  const [name, setName] = useState(query.name ?? "");

  if (!/^[0-9a-f]{64}$/.test(challenge)) {
    return (
      <div className="page">
        <div className="empty-state">
          <h2>{t("linkTitle")}</h2>
          <p className="muted">{t("linkMissing")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="empty-state link-card">
        <Monitor size={32} />
        <h2>{state === "done" ? t("linkApproved") : t("linkTitle")}</h2>
        {state === "done" ? (
          <p className="muted">{t("linkBackToApp")}</p>
        ) : me.role !== "admin" ? (
          <p className="muted">{t("linkAdminOnly")}</p>
        ) : (
          <form
            className="link-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setState("busy");
              setError(null);
              try {
                await api("/app/link", { body: { challenge, name: name.trim() } });
                setState("done");
                reloadOverview();
              } catch (err) {
                setError((err as Error).message);
                setState("ask");
              }
            }}
          >
            <p className="muted">{t("linkHint")}</p>
            <label className="field">
              {t("computerName")}
              <input className="text-field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="primary-button large" disabled={state === "busy" || !name.trim()}>
              {t("linkApprove")}
            </button>
            {error && <p className="error-text">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
