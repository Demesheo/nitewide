import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PrivacyPage } from "./components/privacy-page";
import "./styles.css";
import "./mobile.css";
import "./noir-theme.css";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/^\/privacy\/?$/.test(window.location.pathname) ? <PrivacyPage /> : <App />}
  </React.StrictMode>,
);
