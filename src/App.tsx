import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, isTauri, setConnection, type Device, type Me, type Overview, type ServerInfo } from "./lib/api";
import { refreshAgent, useLocalAgent } from "./lib/agent";
import { AppContext, matches, sortDevices, type AppContextValue, type ListFilter, type SettingsPage } from "./lib/app";
import { MOBILE_QUERY, invalidate, useApi, useMediaQuery } from "./lib/hooks";
import { useRouter } from "./lib/router";
import { SettingsProvider, useSettings } from "./lib/settings";
import { loadConnection, saveConnection, useDesktopSync } from "./lib/desktop";
import { ToastProvider, useToast } from "./components/common";
import { Sidebar } from "./components/Sidebar";
import { SignIn } from "./components/SignIn";
import { Connect } from "./components/Connect";
import { SettingsDialog } from "./components/SettingsDialog";
import { SearchDialog } from "./components/SearchDialog";
import { Toolbar } from "./components/Toolbar";
import { Dashboard } from "./components/devices/Dashboard";
import { DevicePage } from "./components/devices/DevicePage";
import { DevicePanel } from "./components/devices/DevicePanel";
import { LinkPage } from "./components/devices/LinkPage";

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </SettingsProvider>
  );
}

/** The desktop app first needs a server and a key; the web app is on its server already. */
function Root() {
  const [connected, setConnected] = useState<boolean | null>(isTauri ? null : true);
  useEffect(() => {
    if (!isTauri) return;
    void loadConnection().then((c) => {
      setConnection(c);
      setConnected(!!c);
    });
  }, []);
  if (connected === null) return <div className="splash" />;
  if (!connected) return <Connect onConnected={() => setConnected(true)} />;
  return <SignedIn onDisconnected={() => setConnected(false)} />;
}

function SignedIn({ onDisconnected }: { onDisconnected: () => void }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  // Set by the server when single sign-on fails (it redirects back with ?signin_error=…).
  const [signinError] = useState(() => new URLSearchParams(location.search).get("signin_error"));

  const loadMe = useCallback(() => {
    api<Me>("/auth/me").then(setMe, (e) => (e instanceof ApiError && e.status === 0 && isTauri ? onDisconnected() : setMe(null)));
  }, [onDisconnected]);

  useEffect(() => loadMe(), [loadMe]);

  useEffect(() => {
    if (signinError) router.setQuery({ signin_error: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any API call answering 401 means the session ended (or the desktop's key was deleted).
  useEffect(() => {
    const onSignedOut = () => (isTauri ? onDisconnected() : setMe(null));
    window.addEventListener("devices:signed-out", onSignedOut);
    return () => window.removeEventListener("devices:signed-out", onSignedOut);
  }, [onDisconnected]);

  if (me === undefined) return <div className="splash" />;
  if (me === null) return <SignIn error={signinError} onSignedIn={loadMe} />;
  return <Shell me={me} setMe={setMe} router={router} onSignedOut={() => (isTauri ? onDisconnected() : setMe(null))} />;
}

function Shell({ me, setMe, router, onSignedOut }: { me: Me; setMe: (me: Me) => void; router: ReturnType<typeof useRouter>; onSignedOut: () => void }) {
  const { settings, update, t } = useSettings();
  const toast = useToast();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const [drawer, setDrawer] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null);
  const server = useApi<ServerInfo>("/app/server").data;
  const overviewReq = useApi<Overview>("/app/overview", true);
  const local = useLocalAgent();
  useDesktopSync(settings.closeToTray, t);

  const r = router.route;
  const list: ListFilter = (["low", "charging"] as const).find((l) => l === router.query.filter) ?? "all";
  const hostId = r.name === "devices" ? r.host : undefined;
  // This computer's devices: the agent's live readings (every second while the app is open)
  // over what the server last heard, and the ones the server doesn't know yet (computer not
  // linked, or its report hasn't arrived).
  const overview = useMemo(() => {
    const data = overviewReq.data;
    if (!data || !local.devices) return data;
    const known = new Set(data.devices.map((d) => d.id));
    const here = local.info?.link ? data.hosts.find((h) => h.id === local.info!.link!.host_id) : undefined;
    const onlyHere: Device[] = [...local.devices.values()]
      .filter((d) => !known.has(d.id))
      .map((d) => ({
        ...d,
        first_seen_at: null,
        host: { id: here?.id ?? "this-computer", name: here?.name ?? local.info?.computer ?? "This computer", online: true },
      }));
    return {
      ...data,
      devices: [...data.devices.map((d) => {
        const here = local.devices!.get(d.id);
        if (!here) return d;
        return {
          ...d,
          connected: here.connected,
          battery: here.battery ?? d.battery,
          battery_updated_at: here.battery_updated_at ?? d.battery_updated_at,
          last_seen_at: here.last_seen_at ?? d.last_seen_at,
          error: here.error,
        };
      }), ...onlyHere],
    };
  }, [overviewReq.data, local.devices, local.info]);
  const visible = useMemo(
    () => sortDevices((overview?.devices ?? []).filter((d) => matches(d, list, hostId) && (settings.showOffline || d.connected)), settings.sort),
    [overview, list, hostId, settings.showOffline, settings.sort],
  );
  const device = r.name === "device" ? overview?.devices.find((d) => d.id === r.id) : undefined;

  useEffect(() => setDrawer(false), [r]);

  const reloadOverview = useCallback(() => {
    invalidate("/app/overview");
    overviewReq.reload();
  }, [overviewReq.reload]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      // The local agent polls at once and reports; the server then has the new readings.
      if (local.running) await refreshAgent();
      await new Promise((resolve) => setTimeout(resolve, 600));
      reloadOverview();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRefreshing(false);
    }
  };

  const sidebarVisible = mobile ? drawer : settings.sidebar;
  const panelVisible = mobile ? mobilePanel : settings.panel;
  const toggleSidebar = () => (mobile ? setDrawer((d) => !d) : update({ sidebar: !settings.sidebar }));
  const togglePanel = () => (mobile ? setMobilePanel((p) => !p) : update({ panel: !settings.panel }));
  const openDevice = (id: string | null) => router.navigate(id ? { name: "device", id } : { name: "devices" });

  const value: AppContextValue = {
    me,
    setMe,
    server,
    route: r,
    query: router.query,
    navigate: router.navigate,
    setQuery: router.setQuery,
    overview,
    reloadOverview,
    visible,
    list,
    host: hostId ? overview?.hosts.find((h) => h.id === hostId) : undefined,
    openDevice,
    local,
    isLocal: (id) => !!local.ids?.has(id),
    refresh,
    refreshing,
    openSettings: (page) => setSettingsPage(page ?? "profile"),
    signOut: () => {
      if (isTauri) {
        void saveConnection(null).finally(onSignedOut);
        return;
      }
      void api("/auth/logout", { method: "POST" }).finally(() => {
        invalidate();
        onSignedOut();
      });
    },
    sidebarVisible,
    toggleSidebar,
    panelVisible,
    togglePanel,
    openSearch: () => setSearchOpen(true),
  };

  // The same keys as the other apps, plus R (poll now) and J/K (next/previous device).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = !!target.closest?.("input, textarea, select, [contenteditable]");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (ctrl && !e.altKey && !e.shiftKey && (k === "b" || k === "\\")) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (ctrl && !e.altKey && k === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (ctrl && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsPage((p) => p ?? "profile");
        return;
      }
      if (k === "escape" && !settingsPage && !searchOpen && !document.querySelector(".dialog-backdrop, .picker")) {
        if (mobile && (drawer || mobilePanel)) {
          setDrawer(false);
          setMobilePanel(false);
        } else if (r.name === "device" && !inField) openDevice(null);
        return;
      }

      // Single keys: not while typing, in a dialog, or with modifiers.
      if (ctrl || e.altKey || inField || settingsPage || searchOpen) return;
      if (document.querySelector(".dialog-backdrop, .picker")) return;
      if (k === "\\") toggleSidebar();
      else if (k === "/") setSearchOpen(true);
      else if (k === ".") togglePanel();
      else if (k === "r" && !refreshing) void refresh();
      else if ((k === "j" || k === "k") && visible.length) {
        const at = r.name === "device" ? visible.findIndex((d) => d.id === r.id) : -1;
        const next = k === "j" ? (at + 1) % visible.length : (at - 1 + visible.length) % visible.length;
        openDevice(visible[next].id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const listTitle = list === "low" ? t("lowBattery") : list === "charging" ? t("charging") : t("allDevices");
  const title =
    r.name === "link" ? (
      t("linkTitle")
    ) : r.name === "device" ? (
      <>
        <button className="crumb" onClick={() => openDevice(null)}>
          {t("devices")}
        </button>
        <span className="crumb-sep">/</span>
        <span>{device?.name ?? ""}</span>
      </>
    ) : (
      (value.host?.name ?? listTitle)
    );

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {sidebarVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
            <Sidebar />
          </>
        )}
        <main className="main">
          <Toolbar title={title} loading={overviewReq.loading && !overview} />
          <div className="content">
            {overviewReq.error && !overview && <p className="notice error page-notice">{overviewReq.error}</p>}
            {r.name === "link" ? (
              <LinkPage />
            ) : r.name === "device" ? (
              device ? <DevicePage key={device.id} device={device} /> : overview && <p className="page muted">{t("noResults")}</p>
            ) : (
              <Dashboard />
            )}
          </div>
        </main>
        {panelVisible && <DevicePanel device={device} />}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {settingsPage && <SettingsDialog page={settingsPage} onClose={() => setSettingsPage(null)} />}
    </AppContext.Provider>
  );
}
