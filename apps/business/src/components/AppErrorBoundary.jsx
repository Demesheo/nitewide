import React, { useEffect, useRef } from "react";

export function AppRecoveryScreen({ onReload = () => window.location.reload() }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <main aria-labelledby="business-recovery-title" style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: "24px", boxSizing: "border-box", background: "#111018", color: "#f7f2fb" }}>
      <section role="alert" style={{ width: "100%", maxWidth: "30rem", padding: "28px", boxSizing: "border-box", border: "1px solid #51445e", borderRadius: "16px", background: "#211b29" }}>
        <p style={{ color: "#c6b5da", fontSize: "13px", marginBottom: "12px" }}>Nitewide Business</p>
        <h1 id="business-recovery-title" ref={heading} tabIndex={-1} style={{ fontSize: "28px", lineHeight: 1.2, marginBottom: "16px" }}>This page couldn’t open</h1>
        <p style={{ color: "#d4cadd", lineHeight: 1.6 }}>Part of the workspace could not load. Check your connection, then reload this page to try again.</p>
        <p style={{ color: "#c6b5da", fontSize: "13px", lineHeight: 1.6, marginTop: "12px" }}>Reloading keeps your current address and stored sign-in session. Unsaved information may need to be entered again.</p>
        <p style={{ color: "#c6b5da", fontSize: "13px", lineHeight: 1.6, marginTop: "12px" }}>If reloading doesn’t help, close and reopen your browser before trying again. You may need to sign in again.</p>
        <button type="button" onClick={onReload} style={{ minHeight: "44px", marginTop: "24px", padding: "10px 18px", border: "1px solid #d6b7ed", borderRadius: "8px", background: "#dbc1f1", color: "#24132f", font: "inherit", fontWeight: 650, cursor: "pointer" }}>Reload page</button>
      </section>
    </main>
  );
}

// Keep the recovery surface outside the lazy workspace's dependency graph.
// Do not install global error/rejection handlers: an ordinary failed request
// must not replace a healthy sign-in form or discard a typed password.
export default class AppErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <AppRecoveryScreen onReload={this.props.onReload} /> : this.props.children;
  }
}
