import { describe, expect, it } from "vitest";
import { validateJsonFieldValue } from "./json-schema";

describe("validateJsonFieldValue", () => {
  it.each([null, undefined, ""])(
    "normalizes an empty JSON value (%s) to null without a schema",
    (value) => {
      expect(validateJsonFieldValue(undefined, false, value)).toEqual({
        valid: true,
        value: null,
      });
    },
  );

  it("rejects a schema that is not valid Draft 7", () => {
    const result = validateJsonFieldValue(
      { type: "not-a-json-schema-type" },
      false,
      {},
    );

    expect(result).toMatchObject({
      valid: false,
      error: expect.stringContaining("json schema is invalid"),
    });
  });

  it("rejects a schema that declares another JSON Schema dialect", () => {
    const result = validateJsonFieldValue(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
      },
      false,
      {},
    );

    expect(result).toEqual({
      valid: false,
      error: "json schema is invalid: only JSON Schema Draft 7 is supported",
    });
  });

  it("accepts a JSON-string schema and preserves values in validation-only mode", () => {
    const value = { title: "Hello", extra: { retained: true } };
    const result = validateJsonFieldValue(
      JSON.stringify({
        type: "object",
        required: ["title"],
        properties: { title: { type: "string" } },
      }),
      false,
      value,
    );

    expect(result).toEqual({ valid: true, value });
    if (result.valid) expect(result.value).toBe(value);
  });

  it("strips undeclared properties recursively through object and array schemas", () => {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        meta: {
          type: "object",
          properties: { count: { type: "integer" } },
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
    };
    const value = {
      title: "Hello",
      ignored: true,
      meta: { count: 1, ignored: "nested" },
      items: [{ name: "First", ignored: "array item" }],
    };

    expect(validateJsonFieldValue(schema, true, value)).toEqual({
      valid: true,
      value: {
        title: "Hello",
        meta: { count: 1 },
        items: [{ name: "First" }],
      },
    });
    expect(value).toEqual({
      title: "Hello",
      ignored: true,
      meta: { count: 1, ignored: "nested" },
      items: [{ name: "First", ignored: "array item" }],
    });
  });

  it("retains properties selected by patternProperties and strips other additional properties", () => {
    const schema = {
      type: "object",
      patternProperties: {
        "^x-": {
          type: "object",
          properties: { enabled: { type: "boolean" } },
        },
      },
      additionalProperties: { type: "string" },
    };

    expect(
      validateJsonFieldValue(schema, true, {
        "x-feature": { enabled: true, ignored: true },
        acceptedByAdditionalProperties: "removed in strip mode",
      }),
    ).toEqual({
      valid: true,
      value: { "x-feature": { enabled: true } },
    });
  });

  it("lets additionalProperties reject unknown keys when stripUnknown is false", () => {
    const result = validateJsonFieldValue(
      {
        type: "object",
        properties: { title: { type: "string" } },
        additionalProperties: false,
      },
      false,
      { title: "Hello", extra: true },
    );

    expect(result).toMatchObject({
      valid: false,
      error: expect.stringContaining("json schema validation failed"),
    });
  });

  it("resolves local references while recursively stripping nested values", () => {
    const schema = {
      type: "object",
      definitions: {
        node: {
          type: "object",
          properties: {
            name: { type: "string" },
            children: {
              type: "array",
              items: { $ref: "#/definitions/node" },
            },
          },
        },
      },
      properties: {
        root: { $ref: "#/definitions/node" },
      },
    };

    expect(
      validateJsonFieldValue(schema, true, {
        root: {
          name: "root",
          ignored: true,
          children: [{ name: "child", ignored: true }],
        },
      }),
    ).toEqual({
      valid: true,
      value: {
        root: {
          name: "root",
          children: [{ name: "child" }],
        },
      },
    });
  });

  it("combines allOf and the matching conditional branch for stripping", () => {
    const schema = {
      type: "object",
      properties: { kind: { enum: ["article", "page"] } },
      allOf: [
        {
          properties: {
            common: {
              type: "object",
              properties: { enabled: { type: "boolean" } },
            },
          },
        },
      ],
      if: { properties: { kind: { const: "article" } } },
      then: {
        properties: {
          article: {
            type: "object",
            properties: { slug: { type: "string" } },
          },
        },
      },
      else: {
        properties: {
          page: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
    };

    expect(
      validateJsonFieldValue(schema, true, {
        kind: "article",
        common: { enabled: true, ignored: true },
        article: { slug: "news", ignored: true },
        page: { path: "/ignored" },
        ignored: true,
      }),
    ).toEqual({
      valid: true,
      value: {
        kind: "article",
        common: { enabled: true },
        article: { slug: "news" },
      },
    });
  });

  it("uses the matching oneOf branch for object normalization", () => {
    const schema = {
      type: "object",
      properties: { kind: { enum: ["text", "image"] } },
      oneOf: [
        {
          required: ["kind", "text"],
          properties: {
            kind: { const: "text" },
            text: {
              type: "object",
              properties: { body: { type: "string" } },
            },
          },
        },
        {
          required: ["kind", "image"],
          properties: {
            kind: { const: "image" },
            image: {
              type: "object",
              properties: { url: { type: "string" } },
            },
          },
        },
      ],
    };

    expect(
      validateJsonFieldValue(schema, true, {
        kind: "text",
        text: { body: "Hello", ignored: true },
        image: { url: "removed" },
      }),
    ).toEqual({
      valid: true,
      value: { kind: "text", text: { body: "Hello" } },
    });
  });

  it("selects a strict oneOf branch after removing that branch's unknown keys", () => {
    const schema = {
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
    };

    expect(
      validateJsonFieldValue(schema, true, {
        kind: "a",
        payload: "must survive",
        ignored: true,
      }),
    ).toEqual({
      valid: true,
      value: { kind: "a", payload: "must survive" },
    });
  });

  it.each(["oneOf", "anyOf"] as const)(
    "does not erase invalid declared values while selecting a %s branch",
    (keyword) => {
      const schema = {
        [keyword]: [
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
      };
      const value = { kind: "a", payload: 123 };

      expect(validateJsonFieldValue(schema, true, value)).toMatchObject({
        valid: false,
        error: expect.stringContaining("json schema validation failed"),
      });
      expect(value).toEqual({ kind: "a", payload: 123 });
    },
  );

  it("does not delete a sibling oneOf branch property to make a strict branch match", () => {
    const value = { kind: "a", payload: "valid", fallback: "sibling" };
    const result = validateJsonFieldValue(
      {
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
          {
            type: "object",
            properties: {
              kind: { const: "b" },
              fallback: { type: "string" },
            },
            required: ["kind", "fallback"],
            additionalProperties: false,
          },
        ],
      },
      true,
      value,
    );

    expect(result).toMatchObject({
      valid: false,
      error: expect.stringContaining("json schema validation failed"),
    });
    expect(value).toEqual({
      kind: "a",
      payload: "valid",
      fallback: "sibling",
    });
  });

  it("rejects a value that matches multiple oneOf branches", () => {
    expect(
      validateJsonFieldValue(
        {
          oneOf: [
            {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
            },
            {
              type: "object",
              properties: { value: { minLength: 1 } },
              required: ["value"],
            },
          ],
        },
        true,
        { value: "matches both" },
      ),
    ).toMatchObject({
      valid: false,
      error: expect.stringContaining("json schema validation failed"),
    });
  });

  it("preserves keys used to select an if/then branch", () => {
    expect(
      validateJsonFieldValue(
        {
          type: "object",
          if: { required: ["flag"] },
          then: {
            required: ["secret"],
            properties: { secret: { type: "string" } },
          },
          else: { maxProperties: 0 },
        },
        true,
        { flag: true, secret: "must-survive" },
      ),
    ).toEqual({
      valid: true,
      value: { flag: true, secret: "must-survive" },
    });
  });

  it("applies an else branch when the Draft 7 if schema is false", () => {
    expect(
      validateJsonFieldValue(
        {
          type: "object",
          if: false,
          else: { properties: { secret: { type: "string" } } },
        },
        true,
        { secret: "must-survive", ignored: true },
      ),
    ).toEqual({
      valid: true,
      value: { secret: "must-survive" },
    });
  });

  it("does not satisfy required with an inherited Object.prototype property", () => {
    expect(
      validateJsonFieldValue(
        { type: "object", required: ["toString"] },
        true,
        {},
      ),
    ).toMatchObject({
      valid: false,
      error: expect.stringContaining("json schema validation failed"),
    });
  });

  it("does not validate an inherited Object.prototype property declaration", () => {
    expect(
      validateJsonFieldValue(
        {
          type: "object",
          properties: { toString: { type: "string" } },
        },
        true,
        {},
      ),
    ).toEqual({ valid: true, value: {} });
  });

  it("does not activate dependencies from an inherited Object.prototype property", () => {
    expect(
      validateJsonFieldValue(
        {
          type: "object",
          dependencies: { toString: ["secret"] },
        },
        true,
        {},
      ),
    ).toEqual({ valid: true, value: {} });
  });

  it("expands schema-form dependencies before recursive stripping", () => {
    expect(
      validateJsonFieldValue(
        {
          type: "object",
          properties: { credit_card: { type: "string" } },
          dependencies: {
            credit_card: {
              required: ["billing_address"],
              properties: { billing_address: { type: "string" } },
            },
          },
        },
        true,
        {
          credit_card: "4111111111111111",
          billing_address: "Example Street",
          ignored: true,
        },
      ),
    ).toEqual({
      valid: true,
      value: {
        credit_card: "4111111111111111",
        billing_address: "Example Street",
      },
    });
  });

  it("applies tuple item schemas without deleting array elements", () => {
    const schema = {
      type: "array",
      items: [
        {
          type: "object",
          properties: { title: { type: "string" } },
        },
        {
          type: "object",
          properties: { count: { type: "integer" } },
        },
      ],
      additionalItems: false,
    };

    expect(
      validateJsonFieldValue(schema, true, [
        { title: "First", ignored: true },
        { count: 2, ignored: true },
      ]),
    ).toEqual({
      valid: true,
      value: [{ title: "First" }, { count: 2 }],
    });
  });

  it("rejects unresolved references before accepting an empty value", () => {
    const result = validateJsonFieldValue(
      { $ref: "#/definitions/missing" },
      false,
      null,
    );

    expect(result).toMatchObject({
      valid: false,
      error: expect.stringContaining("json schema is invalid"),
    });
  });

  it("ignores reference-like annotations outside Draft 7 schema locations", () => {
    const schema = {
      type: "object",
      "x-doc": {
        $ref: "https://example.invalid/not-a-schema",
      },
    };
    const value = { retained: true };

    const result = validateJsonFieldValue(schema, false, value);

    expect(result).toEqual({ valid: true, value });
  });

  it("does not interpret identifiers inside unknown annotations", () => {
    const schema = {
      $id: "https://example.test/schema",
      type: "object",
      "x-doc": {
        $id: "https://example.test/schema",
      },
    };

    expect(validateJsonFieldValue(schema, false, {})).toEqual({
      valid: true,
      value: {},
    });
  });

  it("requires a schema when stripUnknown is enabled", () => {
    expect(validateJsonFieldValue(undefined, true, {})).toEqual({
      valid: false,
      error: "json stripUnknown requires options.schema",
    });
  });
});
