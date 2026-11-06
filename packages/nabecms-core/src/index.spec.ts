import { describe, expect, it } from "vitest";
import * as contracts from "./contracts";
import * as core from "./index";
import { loadConfig } from "./config";
import * as adminRpc from "./rpc/admin";
import * as contentsRpc from "./rpc/contents";

describe("core public root export", () => {
  it("keeps the runtime root export allowlist stable", () => {
    expect(Object.keys(core).toSorted()).toEqual([
      "createApp",
      "defineConfig",
      "loadConfig",
      "runLogCleanup",
      "schema",
    ]);
  });

  it("keeps the contracts runtime export allowlist stable", () => {
    expect(Object.keys(contracts).toSorted()).toEqual([
      "dateFormats",
      "dateVariants",
      "fieldTypes",
      "isInvitableRole",
      "mediaVariants",
      "numberVariants",
      "relationVariants",
      "textVariants",
      "validateJsonFieldValue",
    ]);
  });

  it("keeps the RPC entrypoints type-only", () => {
    expect(Object.keys(adminRpc)).toEqual([]);
    expect(Object.keys(contentsRpc)).toEqual([]);
  });

  it.each([
    ["custom admin base path", { admin: { basePath: "/cms" } }],
    ["admin CORS", { admin: { cors: { allowOrigins: ["*"] } } }],
    ["database binding", { database: { binding: "CMS_DB" } }],
    ["storage config", { storage: { binding: "MEDIA" } }],
    ["auth config", { auth: { jwtSecret: "secret" } }],
    ["scheduled publishing", { publishing: { scheduled: { enabled: true } } }],
    ["locales config", { locales: ["en"] }],
  ])("rejects unsupported v1 config: %s", (_label, config) => {
    expect(() => loadConfig(config as never)).toThrow();
  });
});
