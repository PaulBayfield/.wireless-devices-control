"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { refreshDevices } from "@/app/actions/devices";

import { RefreshIcon } from "./icons";

/** Re-render the page from the server every `seconds`, while the tab is visible. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);

  return null;
}

/** Ask the API to poll every device now. */
export function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-500">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await refreshDevices();
            setError(result.ok ? null : result.error);
          })
        }
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent disabled:opacity-60"
      >
        <RefreshIcon className={`size-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Polling…" : "Refresh"}
      </button>
    </div>
  );
}
