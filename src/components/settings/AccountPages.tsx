import { useEffect, useState } from "react";
import { api, isTauri, serverUrl, type ApiKey, type Session } from "../../lib/api";
import { DEFAULT_AGENT_URL, agentCall, loadAgent, saveAgent } from "../../lib/agent";
import { getAutostart, setAutostart } from "../../lib/desktop";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings, type Settings, type Theme } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { ConfirmDialog, CopyButton, useToast } from "../common";
import { Download, Trash } from "../icons";
import { PageHeader, Row, Switch, WebOnly, useSaveProfile } from "./common";

// --- Profile ---

export function ProfilePage() {
  const { t } = useSettings();
  const { me } = useApp();
  const { save, busy } = useSaveProfile();
  const [name, setName] = useState(me.name);
  return (
    <>
      <PageHeader title={t("profile")} hint={me.email ?? me.id} />
      {me.readOnly && <WebOnly />}
      <section className="settings-rows">
        <Row label={t("displayName")} disabled={me.readOnly}>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ name });
            }}
          >
            <input className="text-field" value={name} maxLength={80} disabled={me.readOnly} onChange={(e) => setName(e.target.value)} />
            <button className="primary-button" disabled={busy || name === me.name || me.readOnly}>
              {t("save")}
            </button>
          </form>
        </Row>
        <Row label={t(`role_${me.role}` as StringKey)} />
      </section>
    </>
  );
}

// --- Preferences ---

const THEMES: Theme[] = ["system", "light", "dark", "rosepine", "rosepine-dawn"];

export function PreferencesPage() {
  const { t, settings, update } = useSettings();
  const select = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => (
    <select value={String(settings[key])} onChange={(e) => update({ [key]: options.find(([v]) => String(v) === e.target.value)![0] } as Partial<Settings>)}>
      {options.map(([value, label]) => (
        <option key={String(value)} value={String(value)}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader title={t("preferences")} hint={t("preferencesHint")} />
      <section>
        <h3>{t("appearance")}</h3>
        <div className="theme-picker">
          {THEMES.map((id) => (
            <button key={id} className={`theme-card${settings.theme === id ? " active" : ""}`} onClick={() => update({ theme: id })}>
              <span className={`theme-preview ${id}`}>
                <span />
                <span />
                <span />
              </span>
              {t(`theme_${id}` as StringKey)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-rows">
        <Row label={t("languageLabel")}>
          {select("language", [
            ["auto", t("automatic")],
            ["fr", "Français"],
            ["en", "English"],
          ])}
        </Row>
        <Row label={t("sortLabel")}>
          {select("sort", [
            ["battery", t("sortBattery")],
            ["name", t("sortName")],
          ])}
        </Row>
        <Row label={t("showOffline")}>
          <Switch checked={settings.showOffline} onChange={(showOffline) => update({ showOffline })} label={t("showOffline")} />
        </Row>
        <Row label={t("hideIdentifiers")} hint={t("hideIdentifiersHint")}>
          <Switch checked={settings.hideIdentifiers} onChange={(hideIdentifiers) => update({ hideIdentifiers })} label={t("hideIdentifiers")} />
        </Row>
      </section>
      {isTauri && <DesktopPreferences />}
    </>
  );
}

function DesktopPreferences() {
  const { t, settings, update } = useSettings();
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  useEffect(() => {
    getAutostart().then(setAutostartState, () => setAutostartState(null));
  }, []);
  return (
    <section className="settings-rows">
      <h3>{t("desktop")}</h3>
      <Row label={t("closeToTray")} hint={t("closeToTrayHint")}>
        <Switch checked={settings.closeToTray} onChange={(closeToTray) => update({ closeToTray })} label={t("closeToTray")} />
      </Row>
      <Row label={t("autostart")} hint={t("autostartHint")} disabled={autostart === null}>
        <Switch
          checked={!!autostart}
          disabled={autostart === null}
          label={t("autostart")}
          onChange={(on) => {
            void setAutostart(on).then(() => setAutostartState(on));
          }}
        />
      </Row>
    </section>
  );
}

// --- This computer (the local agent) ---

export function ThisComputerPage() {
  const { t } = useSettings();
  const { local } = useApp();
  const toast = useToast();
  const saved = loadAgent();
  const [url, setUrl] = useState(saved?.url ?? DEFAULT_AGENT_URL);
  const [token, setToken] = useState(saved?.token ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <>
      <PageHeader title={t("thisComputer")} hint={t("thisComputerHint")} />
      <form
        className="settings-rows"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = { url: url.trim().replace(/\/+$/, ""), token: token.trim() };
            const list = await agentCall<{ devices: unknown[] }>(c, "/devices");
            saveAgent(c);
            local.recheck();
            toast(t("agentOk", { n: list.devices.length }));
          } catch (err) {
            toast((err as Error).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Row label={t("agentAddress")} stack>
          <input className="text-field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={DEFAULT_AGENT_URL} spellCheck={false} />
        </Row>
        <Row label={t("agentToken")} hint={t("agentTokenHint")} stack>
          <input className="text-field" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
        </Row>
        <div className="settings-actions">
          {saved && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                saveAgent(null);
                setToken("");
              }}
            >
              {t("agentForget")}
            </button>
          )}
          <button className="primary-button" disabled={busy || !url.trim() || !token.trim()}>
            {t("connect")}
          </button>
        </div>
        {local.agent && (
          <p className={`small ${local.error ? "error-text" : "muted"}`}>{local.error ?? (local.ids ? t("agentOk", { n: local.ids.size }) : t("loading"))}</p>
        )}
      </form>
    </>
  );
}

// --- Security: sessions and API keys ---

export function SecurityPage() {
  const { me } = useApp();
  return me.readOnly ? <SecurityReadOnly /> : <SecurityFull />;
}

/** An API key can't list or create keys, nor see the sessions. */
function SecurityReadOnly() {
  const { t } = useSettings();
  const { server } = useApp();
  return (
    <>
      <PageHeader title={t("security")} hint={t("securityHint", { name: server?.oidc?.name ?? "SSO" })} />
      <p className="small muted">{t("keysReadOnly")}</p>
      <WebOnly />
    </>
  );
}

function SecurityFull() {
  const { t, f } = useSettings();
  const { server } = useApp();
  const sessions = useApi<Session[]>("/app/sessions");
  const keys = useApi<ApiKey[]>("/app/keys");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const toast = useToast();
  const sso = server?.oidc?.name ?? "SSO";
  const reload = () => {
    invalidate("/app/sessions");
    invalidate("/app/keys");
    sessions.reload();
    keys.reload();
  };

  return (
    <>
      <PageHeader title={t("security")} hint={t("securityHint", { name: sso })} />
      <section>
        <h3>{t("apiKeys")}</h3>
        <p className="small muted">{t("apiKeysHint")}</p>
        {created && (
          <div className="key-reveal">
            <p className="small">{t("keyCreated")}</p>
            <div className="key-box">
              <code>{created}</code>
              <CopyButton text={created} />
            </div>
            <button className="text-button" onClick={() => setCreated(null)}>
              {t("done")}
            </button>
          </div>
        )}
        <div className="settings-list">
          {(keys.data ?? []).map((k) => (
            <div key={k.id} className="settings-list-row">
              <div className="settings-list-main">
                <span>{k.name}</span>
                <span className="small muted">{k.lastUsedAt ? t("lastUsed", { when: f.relative(k.lastUsedAt, t) }) : t("neverUsed")}</span>
              </div>
              <button className="icon-button small danger" title={t("delete")} aria-label={t("delete")} onClick={() => setDeleting(k)}>
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
        {creating ? (
          <form
            className="inline-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api<{ key: string }>("/app/keys", { body: { name } });
                setCreated(r.key);
                setCreating(false);
                setName("");
                reload();
              } catch (err) {
                toast((err as Error).message, "error");
              }
            }}
          >
            <input className="text-field" autoFocus value={name} maxLength={80} placeholder={t("keyNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="text-button" onClick={() => setCreating(false)}>
              {t("cancel")}
            </button>
            <button className="primary-button">{t("create")}</button>
          </form>
        ) : (
          <button className="text-button" onClick={() => setCreating(true)}>
            {t("newKey")}
          </button>
        )}
      </section>

      {!isTauri && (
        <section>
          <h3>{t("sessions")}</h3>
          <div className="settings-list">
            {(sessions.data ?? []).map((s) => (
              <div key={s.id} className="settings-list-row">
                <div className="settings-list-main">
                  <span>
                    {describeAgent(s.userAgent)}
                    {s.current && <span className="badge good">{t("thisDevice")}</span>}
                  </span>
                  <span className="small muted">
                    {t("lastActiveAt", { when: f.relative(s.lastSeenAt, t) })} · {s.ip}
                  </span>
                </div>
                {!s.current && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      await api(`/app/sessions/${s.id}`, { method: "DELETE" });
                      reload();
                    }}
                  >
                    {t("signOutDevice")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {deleting && (
        <ConfirmDialog
          title={t("delete")}
          text={deleting.name}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/app/keys/${deleting.id}`, { method: "DELETE" });
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function describeAgent(ua: string): string {
  const browser = /edg\//i.test(ua) ? "Edge" : /firefox\//i.test(ua) ? "Firefox" : /chrome\//i.test(ua) ? "Chrome" : /safari\//i.test(ua) ? "Safari" : ua.split(" ")[0] || "?";
  const os = /windows/i.test(ua) ? "Windows" : /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iOS" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

// --- Data ---

export function DataPage() {
  const { t } = useSettings();
  const toast = useToast();
  return (
    <>
      <PageHeader title={t("data")} />
      <section className="settings-rows">
        <Row label={t("exportData")} hint={t("exportHint")}>
          <button
            className="text-button"
            onClick={async () => {
              try {
                const data = await api<unknown>("/app/export");
                const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
                const a = document.createElement("a");
                a.href = url;
                a.download = `devices-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                toast((e as Error).message, "error");
              }
            }}
          >
            <Download size={14} />
            {t("download")}
          </button>
        </Row>
        {isTauri && <Row label={t("connectedTo", { url: serverUrl() })} />}
      </section>
    </>
  );
}
