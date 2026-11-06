import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { encodeResourceId } from "./resourceId";

const origin = "https://cms.example.test";
const ids = [
  "model_posts",
  "entry_1",
  "system.super-admin",
  "legacy-only-user",
  "name with spaces",
  "日本語",
  "victim?",
  "../models/victim#",
  "../../victim?",
  "a/b",
  "a\\b",
  "%2e%2e",
  "%252e%252e",
  "a%2fb",
  "a?b#c",
  "\u0000",
  "a\r\nb",
];

describe("resource ID URL boundary", () => {
  it.each(ids)("keeps %j in one API segment without changing endpoint or query", (id) => {
    const segment = encodeResourceId(id);
    const path = `/api/admin/models/${segment}/entries/${segment}/revisions/${segment}/restore`;
    const url = new URL(`${path}?detachReferences=true`, origin);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe(path);
    expect(url.search).toBe("?detachReferences=true");
    expect(url.hash).toBe("");
    const parts = url.pathname.split("/");
    expect(parts).toHaveLength(10);
    expect([parts[4], parts[6], parts[8]].map((part) => decodeURIComponent(part!))).toEqual([id, id, id]);
  });

  it.each(ids)("preserves %j through real router decoding and API URL parsing", async (id) => {
    const router = createRouter({
      history: createMemoryHistory("/admin/"),
      routes: [{ path: "/contents/:modelId/:entryId", component: { render: () => null } }],
    });
    const path = `/contents/${encodeResourceId(id)}/${encodeResourceId(id)}`;
    await router.push(path);
    await router.isReady();
    expect(router.currentRoute.value.params).toEqual({ modelId: id, entryId: id });
    const apiUrl = new URL(
      `/api/admin/models/${encodeResourceId(router.currentRoute.value.params.modelId)}/entries/${encodeResourceId(router.currentRoute.value.params.entryId)}`,
      origin,
    );
    expect(apiUrl.pathname).toBe(`/api/admin/models/${encodeResourceId(id)}/entries/${encodeResourceId(id)}`);
    expect(apiUrl.search).toBe("");
    expect(apiUrl.hash).toBe("");
    expect(router.resolve(path).href).toBe(`/admin${path}`);
  });

  it.each(["", ".", "..", null, undefined, 42, ["entry_1"]])("rejects an ambiguous or invalid ID %j", (id) => {
    expect(() => encodeResourceId(id)).toThrow(TypeError);
  });
});
