import { customerPresentation } from './demo-visibility.js';
const API = import.meta.env.VITE_API_URL || "/api";
export async function api(path, { token, body, signal, headers, ...options } = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      signal: signal || AbortSignal.timeout(15000),
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
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
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    // Navigation can cancel a body after fetch has already received successful
    // headers. Keep that cancellation rejected instead of returning no data.
    if (error.name === 'AbortError') throw error;
    if (response.ok) throw new Error('We couldn’t read the response. Please try again.');
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(
      payload.error?.message || "Something went wrong. Please try again.",
    );
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  if (!payload || !Object.hasOwn(payload, 'data')) {
    throw new Error('We couldn’t read the response. Please try again.');
  }
  return customerPresentation(path, payload.data);
}
