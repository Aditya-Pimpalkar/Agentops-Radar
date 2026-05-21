// Server-side (SSR inside Docker): use the internal Docker service name.
// Client-side (browser): use the public host URL.
const BASE_URL =
  typeof window === "undefined"
    ? (process.env.INTERNAL_API_URL ?? "http://api:8000")
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000");

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...options.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
};
