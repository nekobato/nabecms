import { reactive, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { ModelField } from "@/modules/entries";
import { useEntryJsonValidation } from "./useEntryJsonValidation";

const jsonSchema = {
  type: "object",
  required: ["title", "meta"],
  properties: {
    title: { type: "string" },
    meta: {
      type: "object",
      required: ["count"],
      properties: {
        count: { type: "integer" },
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
        },
      },
    },
  },
} as const;

/** Create a JSON model field for composable behavior tests. */
const createJsonField = (options: Record<string, unknown>, hasLocales = false): ModelField => ({
  id: "field_metadata",
  name: "metadata",
  fieldKey: "metadata",
  type: "json",
  required: false,
  hasLocales,
  isPrivate: false,
  isUnique: false,
  variant: null,
  options,
  defaultValue: null,
  position: 0,
  isDisplayTitle: false,
});

/** Return translated test messages with the schema detail preserved. */
const translate = (key: string, params?: Record<string, unknown>): string => `${key}${params?.detail ? `: ${String(params.detail)}` : ""}`;

/** Create the JSON validation composable for one test field. */
const setup = (field: ModelField) => useEntryJsonValidation({ fields: ref([field]), t: translate });

describe("useEntryJsonValidation", () => {
  it("rejects a JSON value that violates its configured schema", () => {
    const field = createJsonField({ schema: jsonSchema });
    const api = setup(field);

    const result = api.normalizeJsonValues({
      metadata: { title: 42, meta: { count: 1 } },
    });

    expect(result.hasErrors).toBe(true);
    expect(api.getJsonError(field, undefined)).toContain("json_schema_invalid");
    expect(api.getJsonError(field, undefined)).toContain("/title");
  });

  it("keeps unknown keys without mutating input when stripUnknown is false", () => {
    const field = createJsonField({
      schema: jsonSchema,
      stripUnknown: false,
    });
    const api = setup(field);
    const value = {
      title: "Hello",
      extra: "kept",
      meta: { count: 1, extra: "kept" },
    };

    const result = api.normalizeJsonValues({ metadata: value });

    expect(result).toEqual({
      hasErrors: false,
      values: { metadata: value },
    });
    expect(value).toEqual({
      title: "Hello",
      extra: "kept",
      meta: { count: 1, extra: "kept" },
    });
  });

  it("strips unknown keys recursively without mutating input", () => {
    const field = createJsonField({
      schema: jsonSchema,
      stripUnknown: true,
    });
    const api = setup(field);
    const value = reactive({
      title: "Hello",
      ignored: true,
      meta: { count: 1, ignored: "nested" },
      items: [{ name: "First", ignored: "array item" }],
    });

    const result = api.normalizeJsonValues({ metadata: value });

    expect(result).toEqual({
      hasErrors: false,
      values: {
        metadata: {
          title: "Hello",
          meta: { count: 1 },
          items: [{ name: "First" }],
        },
      },
    });
    expect(value).toEqual({
      title: "Hello",
      ignored: true,
      meta: { count: 1, ignored: "nested" },
      items: [{ name: "First", ignored: "array item" }],
    });
  });

  it("normalizes each localized JSON value with the same strip rules", () => {
    const field = createJsonField({ schema: JSON.stringify(jsonSchema), stripUnknown: true }, true);
    const api = setup(field);
    const values = {
      metadata: {
        en: {
          title: "English",
          extra: true,
          meta: { count: 1, extra: true },
        },
        ja: {
          title: "Japanese",
          extra: true,
          meta: { count: 2, extra: true },
        },
      },
    };

    const result = api.normalizeJsonValues(values);

    expect(result).toEqual({
      hasErrors: false,
      values: {
        metadata: {
          en: { title: "English", meta: { count: 1 } },
          ja: { title: "Japanese", meta: { count: 2 } },
        },
      },
    });
    expect(values.metadata.en).toHaveProperty("extra", true);
    expect(values.metadata.ja.meta).toHaveProperty("extra", true);
  });

  it("rejects an invalid configured JSON schema", () => {
    const field = createJsonField({
      schema: { type: "not-a-json-schema-type" },
    });
    const api = setup(field);

    const result = api.normalizeJsonValues({
      metadata: { title: "Hello", meta: { count: 1 } },
    });

    expect(result.hasErrors).toBe(true);
    expect(api.getJsonError(field, undefined)).toContain("json schema is invalid");
  });

  it("rejects stripUnknown when no schema is configured", () => {
    const field = createJsonField({ stripUnknown: true });
    const api = setup(field);

    const result = api.normalizeJsonValues({ metadata: { title: "Hello" } });

    expect(result.hasErrors).toBe(true);
    expect(api.getJsonError(field, undefined)).toContain("stripUnknown requires options.schema");
  });

  it("normalizes an empty value to null after validating schema configuration", () => {
    const field = createJsonField({ schema: jsonSchema });
    const api = setup(field);

    const result = api.normalizeJsonValues({ metadata: "" });

    expect(result).toEqual({
      hasErrors: false,
      values: { metadata: null },
    });
  });

  it("uses Draft 7 patternProperties and local references while stripping", () => {
    const field = createJsonField({
      stripUnknown: true,
      schema: {
        type: "object",
        definitions: {
          setting: {
            type: "object",
            properties: { enabled: { type: "boolean" } },
          },
        },
        patternProperties: {
          "^x-": { $ref: "#/definitions/setting" },
        },
        additionalProperties: { type: "string" },
      },
    });
    const api = setup(field);

    expect(
      api.normalizeJsonValues({
        metadata: {
          "x-preview": { enabled: true, ignored: true },
          additional: "removed",
        },
      }),
    ).toEqual({
      hasErrors: false,
      values: { metadata: { "x-preview": { enabled: true } } },
    });
  });

  it("preserves a strict oneOf branch payload while stripping unknown keys", () => {
    const field = createJsonField({
      stripUnknown: true,
      schema: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "a" },
              payload: { type: "string" },
            },
            required: ["kind", "payload"],
            additionalProperties: false,
          },
          { type: "object", maxProperties: 0 },
        ],
      },
    });
    const api = setup(field);

    expect(
      api.normalizeJsonValues({
        metadata: {
          kind: "a",
          payload: "must survive",
          ignored: true,
        },
      }),
    ).toEqual({
      hasErrors: false,
      values: {
        metadata: { kind: "a", payload: "must survive" },
      },
    });
  });

  it("rejects a malformed Draft 7 keyword configuration", () => {
    const field = createJsonField({ schema: { required: "title" } });
    const api = setup(field);

    const result = api.normalizeJsonValues({ metadata: {} });

    expect(result.hasErrors).toBe(true);
    expect(api.getJsonError(field, undefined)).toContain("json schema is invalid");
  });
});
