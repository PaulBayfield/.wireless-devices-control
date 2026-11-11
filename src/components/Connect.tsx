// Desktop only: which server to use, and the personal API key to use it with.

import { useState } from "react";
import { api, isTauri, setConnection, type Me } from "../lib/api";
import { saveConnection } from "../lib/desktop";
import { useSettings } from "../lib/settings";
import { WindowControls } from "./Toolbar";

export function Connect({ onConnected }: { onConnected: () => void }) {
  const { t } = useSettings();
  const [url, setUrl] = useState("https://devices.bayfield.dev");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="signin" data-tauri-drag-region>
      {isTauri && (
        <div className="signin-controls">
          <WindowControls />
        </div>
      )}
      <form
        className="signin-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const c = { url: url.trim().replace(/\/+$/, ""), key: key.trim() };
          setConnection(c);
          try {
            await api<Me>("/auth/me");
            await saveConnection(c);
            onConnected();
          } catch (err) {
            setConnection(null);
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <img className="signin-logo" src="/favicon.svg" alt="" />
        <h1>{t("connectTitle")}</h1>
        <p className="muted">{t("connectHint")}</p>
        <label className="field">
          {t("serverAddress")}
          <input className="text-field large" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </label>
        <label className="field">
          {t("apiKey")}
          <input className="text-field large" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="dvc_…" autoComplete="off" />
        </label>
        <button className="primary-button large" disabled={busy || !url.trim() || !key.trim()}>
          {t("connect")}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
