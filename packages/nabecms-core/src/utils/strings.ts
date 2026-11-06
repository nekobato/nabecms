export function sanitizeFilename(input: string): string {
  const trimmed = input.trim();
  const replaced = trimmed.replace(/[\\/]+/g, "-").replace(/\s+/g, "-");
  const cleaned = replaced.replace(/[^A-Za-z0-9._-]/g, "");
  const fallback = cleaned || "file";
  const collapse = fallback.replace(/-+/g, "-");
  return collapse.toLowerCase();
}
