import { useEffect, useState } from "react";
import { api, isTauri, type AuthConfig } from "../lib/api";
import { useSettings } from "../lib/settings";
import { WindowControls } from "./Toolbar";
import { Spinner } from "./common";

/** Sign-in goes through the identity provider (Authentik); there are no Devices passwords. */
export function SignIn({ error: initialError, onSignedIn }: { error: string | null; onSignedIn: () => void }) {
  const { t } = useSettings();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    api<AuthConfig>("/auth/config").then(setConfig, (e: Error) => setError(e.message));
  }, []);

  return (
    <div className="signin" data-tauri-drag-region>
      {isTauri && (
        <div className="signin-controls">
          <WindowControls />
        </div>
      )}
      <div className="signin-card">
        <img className="signin-logo" src="/favicon.svg" alt="" />
        <h1>{t("appName")}</h1>
        <p className="muted">{t("signInTagline")}</p>
        {!config ? (
          !error && <Spinner />
        ) : (
          <>
            {config.oidc && (
              <a className="primary-button large" href="/api/auth/oidc/start">
                {t("signInWith", { name: config.oidc.name })}
              </a>
            )}
            {config.dev && (
              <button
                className="text-button large"
                onClick={() => {
                  setError(null);
                  api("/auth/dev-login", { method: "POST" }).then(onSignedIn, (e: Error) => setError(e.message));
                }}
              >
                {t("devSignIn")}
              </button>
            )}
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
