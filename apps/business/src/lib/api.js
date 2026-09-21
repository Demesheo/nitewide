export const SESSION_KEY = "nitewide.business.session";
export function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return s?.accessToken && new Date(s.expiresAt) > new Date() ? s : null;
  } catch {
    return null;
  }
}
export async function api(path, session, options = {}) {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL || "/api"}${path}`,
    {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(session?.accessToken
          ? { Authorization: `Bearer ${session.accessToken}` }
          : {}),
        ...options.headers,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const details = payload?.error?.details;
    const fields = details?.fieldErrors
      ? Object.entries(details.fieldErrors)
          .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
          .join("; ")
      : "";
    const error = new Error(
      fields ||
        payload?.error?.message ||
        "Unable to reach Nitewide. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return payload.data;
}
export function mediaSrc(url) {
  const base = import.meta.env.VITE_API_URL;
  return base && /^https?:\/\//.test(base) ? new URL(url, base).href : url;
}
