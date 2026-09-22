import { customerPresentation } from './demo-visibility.js';
const API = import.meta.env.VITE_API_URL || "/api";
export async function api(path, { token, body, signal, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      signal: signal || AbortSignal.timeout(15000),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body
        ? { body: JSON.stringify(body), method: options.method || "POST" }
        : {}),
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(
      "We couldn’t connect. Please check your connection and try again.",
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.error?.message || "Something went wrong. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return customerPresentation(path, payload.data);
}
