import { describe, it, expect } from "vitest";
import { nextTick, ref } from "vue";

import { useFieldDefinitionForm } from "../useFieldDefinitionForm";

const t = (key: string) => key;

describe("useFieldDefinitionForm submit disabling", () => {
  const setup = () => useFieldDefinitionForm(t, ref(true));

  it("disables submission while in select step", () => {
    const api = setup();

    expect(api.isSubmitDisabled.value).toBe(true);
  });

  it("requires field name and valid key for text fields", async () => {
    const api = setup();

    api.handleSelectType("text");
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(true);

    api.form.name = "Title";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(true);

    api.form.variant = "shortText";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(false);

    api.form.name = "123";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(true);

    api.handleFieldKeyInput("custom_key");
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(false);
  });

  it("offers only supported text variants", async () => {
    const api = setup();

    api.handleSelectType("text");
    await nextTick();

    expect(api.variantOptions.value.map((option) => option.value)).toEqual(["shortText", "longText", "markdown", "code"]);
  });

  it("does not offer custom fields in the v1 creation catalog", () => {
    const api = setup();

    expect(api.fieldTypes.value.map((fieldType) => fieldType.id)).not.toContain("custom");
  });

  it("requires allowed models for relation fields", async () => {
    const api = setup();

    api.handleSelectType("relation");
    await nextTick();

    api.form.name = "Related";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(true);

    api.optionsState.relation.allowedModelIds = ["article"];
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(false);
  });

  it("validates optional JSON for custom fields", async () => {
    const api = setup();

    api.handleSelectType("custom");
    await nextTick();

    api.form.name = "Custom Field";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(false);

    api.optionsState.custom.schemaText = "{ invalid";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(true);

    api.optionsState.custom.schemaText = "{}";
    await nextTick();

    expect(api.isSubmitDisabled.value).toBe(false);
  });

  it("builds number payload without number options", async () => {
    const api = setup();

    api.handleSelectType("number");
    await nextTick();

    api.form.name = "Score";
    api.form.variant = "decimal";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toBeNull();
  });

  it("builds date payload with format only", async () => {
    const api = setup();

    api.handleSelectType("date");
    await nextTick();

    api.form.name = "Published At";
    api.optionsState.date.format = "datetime";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({
      format: "datetime",
    });
  });

  it("builds media payload with allowed kinds only", async () => {
    const api = setup();

    api.handleSelectType("media");
    await nextTick();

    api.form.name = "Hero";
    api.optionsState.media.allowedKinds = ["image", "video"];
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({
      allowedKinds: ["image", "video"],
    });
  });

  it("builds boolean payload without null-state options", async () => {
    const api = setup();

    api.handleSelectType("boolean");
    await nextTick();

    api.form.name = "Featured";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toBeNull();
  });

  it("offers only simple list item types", async () => {
    const api = setup();

    api.handleSelectType("list");
    await nextTick();

    expect(api.listItemTypeOptions.value.map((option) => option.value)).toEqual(["text", "number", "date", "boolean"]);
  });

  it("builds list payload without list options", async () => {
    const api = setup();

    api.handleSelectType("list");
    await nextTick();

    api.form.name = "List Field";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({
      item: {
        type: "text",
      },
    });
  });

  it("builds list number item payload without number options", async () => {
    const api = setup();

    api.handleSelectType("list");
    await nextTick();

    api.form.name = "Number List";
    api.optionsState.list.itemType = "number";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({
      item: {
        type: "number",
      },
    });
  });

  it("builds list date item payload without date options", async () => {
    const api = setup();

    api.handleSelectType("list");
    await nextTick();

    api.form.name = "Date List";
    api.optionsState.list.itemType = "date";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({
      item: {
        type: "date",
      },
    });
  });

  it("builds list boolean item payload without boolean options", async () => {
    const api = setup();

    api.handleSelectType("list");
    await nextTick();

    api.form.name = "Boolean List";
    api.optionsState.list.itemType = "boolean";
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({
      item: {
        type: "boolean",
      },
    });
  });

  it("builds relation payload with allowed models only", async () => {
    const api = setup();

    api.handleSelectType("relation");
    await nextTick();

    api.form.name = "Related";
    await nextTick();

    api.optionsState.relation.allowedModelIds = ["article"];
    await nextTick();

    const payload = api.buildPayload();
    expect(payload?.options).toEqual({ allowedModels: ["article"] });
  });
});
