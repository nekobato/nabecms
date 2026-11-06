/// <reference types="node" />

/**
 * Shared helpers and state contracts for the release browser smoke tests.
 * @module e2e/support
 */
import { readFile, writeFile } from "node:fs/promises";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

type JsonResponse = {
  ok: () => boolean;
  status: () => number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  url: () => string;
};

export type ReleaseState = {
  modelId: string;
  entryId: string;
  mediaId: string;
};

/** Return one required launcher-provided environment value. */
export const requireE2eEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required E2E environment variable: ${name}`);
  return value;
};

/** Resolve the Worker origin from the launcher-provided Admin base URL. */
export const getWorkerOrigin = (): string => new URL(requireE2eEnv("NABECMS_E2E_BASE_URL")).origin;

/** Resolve the transient storage-state path shared by Playwright projects. */
export const getAuthStatePath = (): string => requireE2eEnv("NABECMS_E2E_AUTH_STATE");

/** Resolve the transient release-state path next to the auth state. */
export const getReleaseStatePath = (): string => `${getAuthStatePath()}.release.json`;

/** Decode a successful JSON response or fail with its response body. */
export const readJson = async <T>(response: JsonResponse): Promise<T> => {
  if (!response.ok()) {
    throw new Error(`${response.url()} failed (${response.status()}): ${await response.text()}`);
  }
  return (await response.json()) as T;
};

/** Exchange the current browser cookie for an Admin bearer token. */
export const getAdminAccessToken = async (request: APIRequestContext): Promise<string> => {
  const sessionResponse = await request.post("/api/admin/auth/session-token");
  if (sessionResponse.ok()) {
    const body = (await sessionResponse.json()) as { accessToken?: unknown };
    if (typeof body.accessToken === "string" && body.accessToken.length > 0) return body.accessToken;
  }

  const refreshResponse = await request.post("/api/admin/auth/refresh");
  const body = await readJson<{ accessToken?: unknown }>(refreshResponse);
  if (typeof body.accessToken !== "string" || body.accessToken.length === 0) {
    throw new Error("Admin refresh response did not contain an access token");
  }
  return body.accessToken;
};

/** Send one authenticated Admin API request from the current browser context. */
export const adminRequest = async (
  page: Page,
  path: string,
  options: { method?: string; data?: unknown; multipart?: Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }> } = {},
): Promise<APIResponse> => {
  const accessToken = await getAdminAccessToken(page.request);
  return page.request.fetch(path, {
    method: options.method,
    data: options.data,
    multipart: options.multipart,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
};

/** Persist IDs created by the desktop smoke for the mobile project. */
export const writeReleaseState = async (state: ReleaseState): Promise<void> => {
  await writeFile(getReleaseStatePath(), `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
};

/** Load IDs created by the desktop smoke. */
export const readReleaseState = async (): Promise<ReleaseState> => JSON.parse(await readFile(getReleaseStatePath(), "utf8")) as ReleaseState;
