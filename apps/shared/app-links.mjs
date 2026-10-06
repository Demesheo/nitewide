// Hosted builds get these public URLs before React starts. Local Vite apps keep
// their existing build-time/localhost defaults; no tokens cross app origins.
export function publicAppLink(name, fallback, environment = globalThis) {
  return environment.window?.__NITEWIDE_PUBLIC_CONFIG__?.[name] || fallback;
}
