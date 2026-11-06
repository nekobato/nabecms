/** Serialize an opaque resource ID as one URL path segment, before URL parsing. */
export function encodeResourceId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value === "." || value === "..") {
    throw new TypeError("Invalid resource ID");
  }
  return encodeURIComponent(value);
}
