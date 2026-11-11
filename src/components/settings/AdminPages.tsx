import { useState } from "react";
import { api, serverUrl, type Host, type InternalStatus, type UserRow } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import type { UpdateCheck } from "../../lib/updates";
import { ConfirmDialog, CopyButton, useToast } from "../common";
import { ExternalLink, Key, Pencil, Trash } from "../icons";
import { PageHeader, Row, WebOnly } from "./common";

// --- Computers ---

export function ComputersPage() {
  const { t, f } = useSettings();
  const { me, reloadOverview } = useApp();
  const hosts = useApi<Host[]>("/app/hosts");
  const toast = useToast();
  // Adding, renaming and removing computers needs a signed-in session (not the desktop app's key).
  const admin = me.role === "admin" && !me.readOnly;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [confirm, setConfirm] = useState<{ host: Host; kind: "key" | "remove" } | null>(null);
  /** The computer being renamed, in place. */
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const reload = () => {
    invalidate("/app/hosts");
    hosts.reload();
    reloadOverview();
  };

  const env = (key: string) => `CENTRAL_URL = ${serverUrl()}\nAGENT_KEY = ${key}`;

  return (
    <>
      <PageHeader title={t("computers")} hint={t("computersHint")} />
      {me.role === "admin" && me.readOnly && <WebOnly />}
      {created && (
        <div className="key-reveal">
          <p className="small">{t("agentKeyCreated", { name: created.name })}</p>
          <p className="small muted">{t("agentSetup", { name: created.name })}</p>
          <div className="key-box">
            <code>{env(created.key)}</code>
            <CopyButton text={env(created.key)} />
          </div>
          <div className="key-box">
            <code>uv run __main__.py serve</code>
            <CopyButton text="uv run __main__.py serve" />
          </div>
          <button className="text-button" onClick={() => setCreated(null)}>
            {t("done")}
          </button>
        </div>
      )}
      <section>
        <div className="settings-list">
          {(hosts.data ?? []).map((h) => (
            <div key={h.id} className="settings-list-row">
              <span className={`status-dot${h.online ? " on" : ""}`} title={h.online ? t("online") : t("offline")} />
              <div className="settings-list-main">
                {editing?.id === h.id ? (
                  <form
                    className="inline-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const next = editing.name.trim();
                      setEditing(null);
                      if (!next || next === h.name) return;
                      try {
                        await api(`/app/hosts/${h.id}`, { method: "PATCH", body: { name: next } });
                        reload();
                      } catch (err) {
                        toast((err as Error).message, "error");
                      }
                    }}
                  >
                    <input
                      className="text-field"
                      autoFocus
                      value={editing.name}
                      maxLength={80}
                      aria-label={t("computerName")}
                      onChange={(e) => setEditing({ id: h.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Escape") return;
                        // Cancel the rename only, not the whole settings dialog.
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                        setEditing(null);
                      }}
                    />
                    <button type="button" className="text-button" onClick={() => setEditing(null)}>
                      {t("cancel")}
                    </button>
                    <button className="primary-button" disabled={!editing.name.trim()}>
                      {t("save")}
                    </button>
                  </form>
                ) : (
                  <span>{h.name}</span>
                )}
                <span className="small muted">
                  {[h.platform, h.agent_version && t("agentVersion", { version: h.agent_version }), t("everySeconds", { n: h.poll_interval }), h.last_seen_at ? t("lastReport", { when: f.relative(h.last_seen_at, t) }) : t("neverReported")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {admin && (
                <>
                  <button
                    className="icon-button small"
                    title={t("rename")}
                    aria-label={t("rename")}
                    onClick={() => setEditing({ id: h.id, name: h.name })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button className="icon-button small" title={t("newAgentKey")} aria-label={t("newAgentKey")} onClick={() => setConfirm({ host: h, kind: "key" })}>
                    <Key size={14} />
                  </button>
                  <button className="icon-button small danger" title={t("removeComputer")} aria-label={t("removeComputer")} onClick={() => setConfirm({ host: h, kind: "remove" })}>
                    <Trash size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        {admin &&
          (adding ? (
            <form
              className="inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const r = await api<{ name: string; key: string }>("/app/hosts", { body: { name } });
                  setCreated(r);
                  setAdding(false);
                  setName("");
                  reload();
                } catch (err) {
                  toast((err as Error).message, "error");
                }
              }}
            >
              <input className="text-field" autoFocus value={name} maxLength={80} placeholder={t("computerNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
              <button type="button" className="text-button" onClick={() => setAdding(false)}>
                {t("cancel")}
              </button>
              <button className="primary-button" disabled={!name.trim()}>
                {t("create")}
              </button>
            </form>
          ) : (
            <button className="text-button" onClick={() => setAdding(true)}>
              {t("addComputer")}
            </button>
          ))}
      </section>
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "key" ? t("newAgentKey") : t("removeComputer")}
          text={confirm.kind === "key" ? t("newAgentKeyText", { name: confirm.host.name }) : t("removeComputerText", { name: confirm.host.name })}
          action={confirm.kind === "key" ? t("newAgentKey") : t("removeComputer")}
          onConfirm={async () => {
            if (confirm.kind === "key") {
              const r = await api<{ key: string }>(`/app/hosts/${confirm.host.id}/key`, { method: "POST" });
              setCreated({ name: confirm.host.name, key: r.key });
            } else {
              await api(`/app/hosts/${confirm.host.id}`, { method: "DELETE" });
            }
            reload();
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}

// --- Users ---

export function UsersPage() {
  const { t, f } = useSettings();
  const { me } = useApp();
  const users = useApi<UserRow[]>("/app/users");
  const toast = useToast();
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const reload = () => {
    invalidate("/app/users");
    users.reload();
  };

  return (
    <>
      <PageHeader title={t("users")} hint={t("usersHint")} />
      <div className="settings-list">
        {(users.data ?? []).map((u) => (
          <div key={u.id} className="settings-list-row">
            <div className="settings-list-main">
              <span>
                {u.name} {u.id === me.id && <span className="muted">({t("you")})</span>}
              </span>
              <span className="small muted">{[u.email ?? u.id, u.lastSeenAt && t("lastActiveAt", { when: f.relative(u.lastSeenAt, t) })].filter(Boolean).join(" · ")}</span>
            </div>
            <select
              value={u.role}
              disabled={u.id === me.id}
              onChange={async (e) => {
                try {
                  await api(`/app/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } });
                  reload();
                } catch (err) {
                  toast((err as Error).message, "error");
                }
              }}
            >
              {(["viewer", "admin"] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`role_${r}` as StringKey)}
                </option>
              ))}
            </select>
            {u.id !== me.id && (
              <button className="icon-button small danger" title={t("delete")} aria-label={t("delete")} onClick={() => setDeleting(u)}>
                <Trash size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {deleting && (
        <ConfirmDialog
          title={t("delete")}
          text={t("deleteUserText", { name: deleting.name })}
          word={deleting.id}
          action={t("delete")}
          onConfirm={async () => {
            await api(`/app/users/${deleting.id}`, { method: "DELETE" });
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// --- internal.bayfield.dev ---

export function InternalPage() {
  const { t, f } = useSettings();
  const status = useApi<InternalStatus>("/app/internal");
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const s = status.data;
  const when = (iso: string | null) => (iso ? f.relative(iso, t) : t("never"));

  return (
    <>
      <PageHeader title={t("internal")} hint={t("internalHint")} />
      {s && !s.configured ? (
        <p className="small muted">{t("internalOff")}</p>
      ) : (
        s && (
          <section className="settings-rows">
            <Row label={t("internalEvery", { n: s.minutes ?? 5, url: s.url ?? "" })}>
              <button
                className="text-button"
                disabled={syncing}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    await api("/app/internal/sync", { method: "POST" });
                    invalidate("/app/internal");
                    status.reload();
                  } catch (e) {
                    toast((e as Error).message, "error");
                  } finally {
                    setSyncing(false);
                  }
                }}
              >
                {t("syncNow")}
              </button>
            </Row>
            <Row label={t("lastSync")} hint={s.error ?? undefined}>
              <span className={`small ${s.error ? "error-text" : "muted"}`}>{when(s.lastSyncAt)}</span>
            </Row>
            <Row label={t("lastSuccess")}>
              <span className="small muted">
                {when(s.lastSuccessAt)}
                {s.lastSuccessAt ? ` · ${t("runsCount", { n: f.number(s.runsSent) })}` : ""}
              </span>
            </Row>
            <Row label={t("pendingRuns")}>
              <span className="small muted tabular">{t("runsCount", { n: f.number(s.pending) })}</span>
            </Row>
          </section>
        )
      )}
    </>
  );
}

// --- About ---

export function AboutPage({ updates }: { updates: UpdateCheck }) {
  const { t, f } = useSettings();
  const { server } = useApp();
  const { status, checking, error, check } = updates;
  const version = status?.current ?? (server?.version && server.version !== "dev" ? server.version : __APP_VERSION__);
  const latest = status?.available ? status.latest : null;

  const hint = status?.disabled
    ? t("updateCheckOff")
    : checking
      ? t("checkingUpdates")
      : latest
        ? t("updateAvailable", { version: latest.version })
        : error
          ? t("updateCheckFailed")
          : status?.latest
            ? t("upToDate")
            : t("noReleases");

  return (
    <>
      <PageHeader title={t("about")} />
      <section className="settings-rows">
        <Row label={t("appName")} hint={t("aboutText")}>
          <span className="muted small tabular">{t("version", { version })}</span>
        </Row>
        <Row
          label={t("updates")}
          hint={
            <>
              {hint}
              {latest && <> {t("updateHowTo")}</>}
              {!latest && status?.checkedAt && !checking && !status.disabled && <> · {t("lastChecked", { when: f.relative(status.checkedAt, t) })}</>}
            </>
          }
        >
          {latest ? (
            <a className="primary-button" href={latest.url} target="_blank" rel="noreferrer">
              {t("whatsNew")}
            </a>
          ) : (
            !status?.disabled && (
              <button className="text-button" disabled={checking} onClick={() => void check()}>
                {t("checkForUpdates")}
              </button>
            )
          )}
        </Row>
        <Row label={t("allVersions")}>
          <a className="text-button" href={status?.releasesUrl || "https://github.com/PaulBayfield/devices.bayfield.dev/releases"} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t("releaseNotes")}
          </a>
        </Row>
        <Row label={t("sourceCode")}>
          <a className="text-button" href="https://github.com/PaulBayfield/devices.bayfield.dev" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            GitHub
          </a>
        </Row>
      </section>
    </>
  );
}
