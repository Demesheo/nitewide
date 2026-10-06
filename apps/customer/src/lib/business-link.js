import { publicAppLink } from '../../../shared/app-links.mjs';

export function businessLink(configured, location) {
  const runtime = publicAppLink('businessHome');
  if (runtime) return runtime;
  if (configured) return configured;
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    return `${location.protocol}//${location.hostname}:5174/`;
  }
  return "/business";
}
