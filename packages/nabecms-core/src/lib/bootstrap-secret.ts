import type { Env } from "../types";

export const BOOTSTRAP_SECRET_HEADER = "X-Nabecms-Bootstrap-Secret" as const;

const encoder = new TextEncoder();

/**
 * Read the deployment-provided bootstrap secret from the Worker environment.
 */
export const getBootstrapSecret = (
  env: Pick<Env, "BOOTSTRAP_SECRET">,
): string | null => {
  const secret = env.BOOTSTRAP_SECRET?.trim() ?? "";
  return secret.length > 0 ? secret : null;
};

/**
 * Compare two strings without returning early on the first differing byte.
 */
export const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
};
