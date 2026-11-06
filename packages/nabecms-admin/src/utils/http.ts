import type { useAuthStore } from "@/stores/auth";

export type AuthStore = ReturnType<typeof useAuthStore>;
export type UnauthorizedHandler = () => void | Promise<void>;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Install the navigation handler used when an authorized request remains unauthenticated.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function buildHeaders(init?: RequestInit): Headers {
  if (init?.headers instanceof Headers) return new Headers(init.headers);
  if (Array.isArray(init?.headers)) return new Headers(init.headers);
  if (init?.headers && typeof init.headers === "object") {
    return new Headers(init.headers as Record<string, string>);
  }
  return new Headers();
}

const requiresIdempotencyKey = (input: RequestInfo | URL, init: RequestInit): boolean => {
  const method = init.method ?? (input instanceof Request ? input.method : "GET");
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
};

export async function authorizedFetch(authStore: AuthStore, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = buildHeaders(init);

  if (requiresIdempotencyKey(input, init) && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", crypto.randomUUID());
  }

  if (authStore.accessToken) {
    headers.set("Authorization", `Bearer ${authStore.accessToken}`);
  }

  const run = () =>
    fetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? "include",
    });

  let response = await run();
  if (response.status === 401) {
    const refreshed = await authStore.refresh();
    if (refreshed) {
      if (authStore.accessToken) {
        headers.set("Authorization", `Bearer ${authStore.accessToken}`);
      } else {
        headers.delete("Authorization");
      }
      response = await run();
    }
    if (response.status === 401) {
      await unauthorizedHandler?.();
    }
  }
  return response;
}
