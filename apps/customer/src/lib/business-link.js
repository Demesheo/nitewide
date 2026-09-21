export function businessLink(configured, location) {
  if (configured) return configured;
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    return `${location.protocol}//${location.hostname}:5174/`;
  }
  return "/business";
}
