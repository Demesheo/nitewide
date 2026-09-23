import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./Landing";
import { businessPage } from "./lib/landing-content";
import "./styles.css";
import "./mobile.css";
const App = lazy(() => import("./App"));
const page = businessPage(window.location.pathname);
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {page === "landing" ? (
      <Landing />
    ) : page === "workspace" ? (
      <Suspense
        fallback={
          <main className="route-loading" role="status">
            Opening your workspace…
          </main>
        }
      >
        <App />
      </Suspense>
    ) : (
      <main className="route-loading">
        <h1>Page not found</h1>
        <a href="/">Return to Nitewide Business</a>
      </main>
    )}
  </React.StrictMode>,
);
