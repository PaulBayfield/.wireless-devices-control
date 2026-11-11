import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./devices.css";

// Back from single sign-on (which always lands on "/"): return to the page that asked for it.
try {
  const back = sessionStorage.getItem("devices.returnTo");
  if (back && location.pathname === "/" && !location.search.includes("signin_error")) history.replaceState(null, "", back);
  sessionStorage.removeItem("devices.returnTo");
} catch {
  // Storage unavailable: stay on the home page.
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
