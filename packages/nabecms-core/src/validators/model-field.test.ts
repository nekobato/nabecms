import { describe, expect, test } from "vitest";
import { parseModelFieldPayload } from "./model-field";

const basePayload = {
  name: "title",
  fieldKey: "title",
  required: true,
  hasLocales: false,
  isPrivate: false,
  isDisplayTitle: false,
} as const;

describe("parseModelFieldPayload", () => {
  test("accepts text field variant without text options", () => {
    const result = parseModelFieldPayload({
      ...basePayload,
      type: "text",
      variant: "shortText",
    });

    expect(result.variant).toBe("shortText");
    expect(result.options).toBeNull();
  });

  test("rejects removed text length and pattern options", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "text",
        variant: "shortText",
        options: {
          minLength: 3,
          maxLength: 120,
          pattern: "^[a-z]+$",
        },
      }),
    ).toThrow();
  });

  test("accepts markdown text variant", () => {
    const result = parseModelFieldPayload({
      ...basePayload,
      type: "text",
      variant: "markdown",
    });

    expect(result.variant).toBe("markdown");
  });

  test.each(["slug", "email", "url", "password"])(
    "rejects removed text variant '%s'",
    (variant) => {
      expect(() =>
        parseModelFieldPayload({
          ...basePayload,
          type: "text",
          variant,
        }),
      ).toThrow();
    },
  );

  test("rejects rich_text fields that specify variant", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "rich_text",
        variant: "markdown",
      }),
    ).toThrowError("rich_text fields do not support variant");
  });

  test("accepts number field variant without number options", () => {
    const result = parseModelFieldPayload({
      ...basePayload,
      type: "number",
      variant: "decimal",
    });

    expect(result.variant).toBe("decimal");
    expect(result.options).toBeNull();
  });

  test("rejects removed number options", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "number",
        variant: "decimal",
        options: {
          min: 1,
          max: 10,
          step: 1,
          precision: 10,
          scale: 2,
        },
      }),
    ).toThrow();
  });

  test("accepts date field format without restrictions", () => {
    const result = parseModelFieldPayload({
      ...basePayload,
      type: "date",
      variant: "datetime",
      options: {
        format: "datetime",
      },
    });

    expect(result.options).toEqual({
      format: "datetime",
    });
  });

  test("rejects removed date restriction option", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "date",
        variant: "datetime",
        options: {
          format: "datetime",
          restrict: "futureOnly",
        },
      }),
    ).toThrow();
  });

  test("rejects removed date min and max options", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "date",
        variant: "datetime",
        options: {
          format: "datetime",
          min: "2024-01-01T00:00:00Z",
          max: "2024-12-31T23:59:59Z",
        },
      }),
    ).toThrow();
  });

  test("accepts media field allowed kinds", () => {
    const result = parseModelFieldPayload({
      ...basePayload,
      type: "media",
      variant: "multiple",
      options: {
        allowedKinds: ["image", "video"],
      },
    });

    expect(result.variant).toBe("multiple");
    expect(result.options).toEqual({
      allowedKinds: ["image", "video"],
    });
  });

  test("rejects removed media constraint options", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "media",
        variant: "single",
        options: {
          allowedKinds: ["image"],
          allowedMimeTypes: ["image/png"],
          maxSizeMB: 2,
          image: {
            minWidth: 320,
            maxWidth: 1280,
          },
          requireAltText: true,
        },
      }),
    ).toThrow();
  });

  test("rejects removed boolean null-state option", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "boolean",
        options: {
          tristate: true,
        },
      }),
    ).toThrow();
  });

  test("requires relation fields to set variant and allowed models", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "relation",
        options: {
          allowedModels: ["article"],
        },
      }),
    ).toThrowError("relation fields require variant 'one' or 'many'");
  });

  test("rejects removed relation minimum option", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "relation",
        variant: "many",
        options: {
          allowedModels: ["article"],
          min: 1,
        },
      }),
    ).toThrow();
  });

  test("rejects removed relation maximum option", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "relation",
        variant: "many",
        options: {
          allowedModels: ["article"],
          max: 3,
        },
      }),
    ).toThrow();
  });

  test("accepts list field with nested text item", () => {
    const result = parseModelFieldPayload({
      ...basePayload,
      type: "list",
      options: {
        item: {
          type: "text",
        },
      },
    });

    expect(result.variant).toBeNull();
    expect(result.options).toEqual({
      item: {
        type: "text",
      },
    });
  });

  test.each(["number", "date", "boolean"])(
    "accepts list field with simple %s item",
    (type) => {
      const item = { type };

      const result = parseModelFieldPayload({
        ...basePayload,
        type: "list",
        options: {
          item,
        },
      });

      expect(result.options).toEqual({
        item,
      });
    },
  );

  test("rejects list item variants", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "list",
        options: {
          item: {
            type: "number",
            variant: "integer",
          },
        },
      }),
    ).toThrowError("list item variants are not supported");
  });

  test("rejects removed list item count and uniqueness options", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "list",
        options: {
          minItems: 0,
          maxItems: 5,
          uniqueItems: true,
          item: {
            type: "text",
          },
        },
      }),
    ).toThrow();
  });

  test("rejects list item options", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "list",
        options: {
          item: {
            type: "text",
            variant: "shortText",
            options: {
              maxLength: 30,
            },
          },
        },
      }),
    ).toThrowError("list item options are not supported");
  });

  test.each(["media", "relation", "json"])(
    "rejects complex list item type %s",
    (type) => {
      expect(() =>
        parseModelFieldPayload({
          ...basePayload,
          type: "list",
          options: {
            item: {
              type,
            },
          },
        }),
      ).toThrow();
    },
  );

  test("rejects rich text list items", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "list",
        options: {
          item: {
            type: "rich_text",
          },
        },
      }),
    ).toThrow();
  });

  test("rejects invalid field key format", () => {
    expect(() =>
      parseModelFieldPayload({
        ...basePayload,
        type: "text",
        fieldKey: "_invalid__key",
      }),
    ).toThrowError(
      "fieldKey must be snake_case, start with a lowercase letter, and avoid consecutive underscores",
    );
  });
});
