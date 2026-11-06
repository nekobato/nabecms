import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import { beforeAll, describe, expect, it } from "vitest";
import { defineRule } from "vee-validate";

import en from "@/locales/en.json";
import type { ModelField } from "@/modules/entries";
import EntryFormFields from "../EntryFormFields.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en },
});

const InputTextStub = defineComponent({
  name: "InputText",
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () =>
      h("input", {
        ...attrs,
        "data-testid": `input-${String(attrs.id ?? "")}`,
      });
  },
});

const TextareaStub = defineComponent({
  name: "TextareaStub",
  inheritAttrs: false,
  props: {
    rows: { type: [String, Number], default: undefined },
  },
  setup(props, { attrs }) {
    return () =>
      h("textarea", {
        ...attrs,
        rows: props.rows,
        "data-testid": `textarea-${String(attrs.id ?? "")}`,
      });
  },
});

const MarkdownEditorFieldStub = defineComponent({
  name: "MarkdownEditorField",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("textarea", {
        ...attrs,
        value: props.modelValue,
        "data-testid": `markdown-${String(attrs.id ?? "")}`,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
      });
  },
});

const createField = (overrides: Partial<ModelField>): ModelField => ({
  id: "field_title",
  name: "title",
  fieldKey: "title",
  type: "text",
  required: false,
  hasLocales: false,
  isPrivate: false,
  isUnique: false,
  variant: "shortText",
  options: null,
  defaultValue: null,
  position: 0,
  isDisplayTitle: false,
  ...overrides,
});

const mountEntryFormFields = (
  fields: ModelField[] = [
    createField({ id: "field_title", name: "title", fieldKey: "title", variant: "shortText" }),
    createField({ id: "field_body", name: "body", fieldKey: "body", variant: "longText", position: 1 }),
  ],
  inputIdPrefix = "",
) =>
  mount(EntryFormFields, {
    props: {
      mode: "create",
      model: {
        id: "model_posts",
        name: "Posts",
        fields,
      },
      initialValues: {},
      inputIdPrefix,
    },
    global: {
      plugins: [i18n],
      stubs: {
        InputText: InputTextStub,
        MarkdownEditorField: MarkdownEditorFieldStub,
        ListFieldEditor: {
          name: "ListFieldEditor",
          props: ["modelValue", "itemType", "idBase", "disabled"],
          template: `<div class="list-editor-stub" :data-item-type="itemType" :data-id-base="idBase" />`,
        },
        MediaPickerDialog: true,
        NabeIcon: true,
        SelectButton: true,
        Textarea: TextareaStub,
        Button: {
          name: "Button",
          props: ["label", "type", "disabled", "loading", "icon", "severity", "text", "size"],
          emits: ["click"],
          template: `<button :type="type ?? 'button'" :disabled="disabled || loading" @click="$emit('click')"><slot>{{ label }}</slot></button>`,
        },
      },
    },
  });

describe("EntryFormFields", () => {
  beforeAll(() => {
    defineRule("required", () => true);
  });

  it("shows translated field variants beside field types", () => {
    const wrapper = mountEntryFormFields();

    expect(wrapper.findAll(".field-type-badge").map((badge) => badge.text())).toEqual(["Text", "Text"]);
    expect(wrapper.findAll(".field-variant-badge").map((badge) => badge.text())).toEqual(["Short text", "Long text"]);
  });

  it("renders longText fields as multi-line textareas", () => {
    const wrapper = mountEntryFormFields();

    expect(wrapper.get('[data-testid="input-title"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="textarea-body"]').attributes("rows")).toBe("4");
    expect(wrapper.find('[data-testid="input-body"]').exists()).toBe(false);
  });

  it("prefixes field and section ids when multiple forms share a page", () => {
    const wrapper = mountEntryFormFields([createField({ id: "field_title", name: "title", fieldKey: "title", variant: "shortText" })], "draft-");

    expect(wrapper.get("section").attributes("aria-labelledby")).toBe("draft-fields-section-title");
    expect(wrapper.get("h2").attributes("id")).toBe("draft-fields-section-title");
    expect(wrapper.get(".field-label").attributes("for")).toBe("draft-title");
    expect(wrapper.get('[data-testid="input-draft-title"]').exists()).toBe(true);
  });

  it("renders markdown text fields with the Markdown editor instead of InputText", () => {
    const wrapper = mountEntryFormFields([createField({ id: "field_body", name: "body", fieldKey: "body", variant: "markdown" })]);

    expect(wrapper.get('[data-testid="markdown-body"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="input-body"]').exists()).toBe(false);
  });

  it("renders list fields with the reusable list editor", () => {
    const wrapper = mountEntryFormFields([
      createField({
        id: "field_list",
        name: "list",
        fieldKey: "list",
        type: "list",
        variant: null,
        options: { item: { type: "number" } },
      }),
    ]);

    const editor = wrapper.get(".list-editor-stub");
    expect(editor.attributes("data-item-type")).toBe("number");
    expect(editor.attributes("data-id-base")).toBe("list");
    expect(wrapper.find(".list-editor .helper").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("One value per line");
    expect(wrapper.text()).not.toContain("Item type");
  });
});
