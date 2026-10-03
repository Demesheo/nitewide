import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import AppErrorBoundary from "./components/AppErrorBoundary";
import { businessPage } from "./lib/landing-content";
import "./styles.css";
import "./mobile.css";
const App = lazy(() => import("./App"));
const Landing = lazy(() => import("./Landing"));

function BusinessRoute() {
  const page = businessPage(window.location.pathname, window.location.search);
  return page === "landing" || page === "workspace" ? (
    <Suspense
      fallback={
        <main className="route-loading" role="status">
          Opening Nitewide Business…
        </main>
      }
    >
      {page === "landing" ? <Landing /> : <App />}
    </Suspense>
  ) : (
    <main className="route-loading">
      <h1>Page not found</h1>
      <a href="/">Return to Nitewide Business</a>
    </main>
  );
}

createRoot(document.getElementById("root"), {
  // React has already routed caught errors to the boundary. Never print raw
  // errors, component stacks, route tokens, or user-entered values here.
  onCaughtError: () => {},
}).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BusinessRoute />
    </AppErrorBoundary>
  </React.StrictMode>,
);
