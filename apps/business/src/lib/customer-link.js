export function customerLink(configured, location) {
  if (configured) return configured;
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    return `${location.protocol}//${location.hostname}:5173/`;
  }
  return "/";
}
