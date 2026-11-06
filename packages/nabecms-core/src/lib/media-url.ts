type FallbackBuilder = (input: { key: string; id: string }) => string;

/**
 * Create a resolver that exposes private R2 objects only through a Worker route.
 *
 * R2 object keys are deliberately never converted into bucket or CDN URLs. The
 * Worker endpoint is the authorization boundary for draft and archived media.
 *
 * @param options - Optional Worker route builder
 * @returns Resolver for API media URLs
 */
export function createMediaUrlResolver(options?: {
  fallbackPath?: FallbackBuilder;
}): (input: { key: string; id: string }) => string {
  const fallback: FallbackBuilder =
    options?.fallbackPath ?? (({ id }) => `/api/admin/media/${id}/file`);
  return ({ key, id }) => fallback({ key, id });
}
