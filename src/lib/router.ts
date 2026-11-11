// Address-bar routing: / is every device, /d/<id> one device, /c/<id> the devices of one computer.

import { useCallback, useEffect, useState } from "react";

export type Route = { name: "devices"; host?: string } | { name: "device"; id: string };

export function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").map(decodeURIComponent);
  if (parts[0] === "d" && parts[1]) return { name: "device", id: parts[1] };
  if (parts[0] === "c" && parts[1]) return { name: "devices", host: parts[1] };
  return { name: "devices" };
}

export function routePath(r: Route): string {
  if (r.name === "device") return `/d/${encodeURIComponent(r.id)}`;
  return r.host ? `/c/${encodeURIComponent(r.host)}` : "/";
}

const readQuery = () => Object.fromEntries(new URLSearchParams(location.search));

export function useRouter() {
  const [state, setState] = useState(() => ({ route: parseRoute(location.pathname), query: readQuery() }));

  useEffect(() => {
    const onPop = () => setState({ route: parseRoute(location.pathname), query: readQuery() });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((route: Route, replace = false) => {
    history[replace ? "replaceState" : "pushState"](null, "", routePath(route));
    setState({ route, query: {} });
  }, []);

  /** Changes the query string of the current page. */
  const setQuery = useCallback((patch: Record<string, string | undefined>, replace = false) => {
    setState((s) => {
      const q = { ...s.query };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete q[k];
        else q[k] = v;
      }
      const search = new URLSearchParams(q).toString();
      history[replace ? "replaceState" : "pushState"](null, "", location.pathname + (search ? `?${search}` : ""));
      return { ...s, query: q };
    });
  }, []);

  return { route: state.route, query: state.query, navigate, setQuery };
}
