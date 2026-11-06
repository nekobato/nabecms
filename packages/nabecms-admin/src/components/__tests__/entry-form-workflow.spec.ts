import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, beforeAll } from "vitest";
import { createI18n } from "vue-i18n";
import { defineRule } from "vee-validate";
import EntryForm from "../EntryForm.vue";
import en from "@/locales/en.json";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en },
});

const stubComponent = (name: string) => ({
  name,
  props: ["modelValue", "disabled", "options", "optionLabel", "optionValue", "name", "id"],
  emits: ["update:modelValue"],
  template: `<input :data-testid="'$'+name" :value="modelValue" @input="$emit('update:modelValue', $event.target?.value)" />`,
});

const RichTextStub = {
  name: "RichTextEditor",
  props: ["modelValue", "disabled"],
  emits: ["update:modelValue"],
  template: `<textarea data-testid="rich-text" :value="JSON.stringify(modelValue)" @input="$emit('update:modelValue', { type: 'rich_text', value: $event.target.value })" />`,
};

const RelationStub = {
  name: "RelationFieldEditor",
  props: ["modelValue", "disabled"],
  emits: ["update:modelValue"],
  template: `<input data-testid="relation" :value="JSON.stringify(modelValue)" @input="$emit('update:modelValue', { type: 'one', entryIds: [] })" />`,
};

describe("EntryForm workflow actions", () => {
  const model = {
    id: "model_posts",
    name: "Posts",
    fields: [
      {
        id: "field_title",
        name: "title",
        fieldKey: "title",
        type: "text",
        required: true,
        hasLocales: false,
        isPrivate: false,
        variant: null,
        options: null,
        defaultValue: null,
        position: 0,
        isDisplayTitle: true,
      },
    ],
  };

  const mountForm = () =>
    mount(EntryForm, {
      props: {
        mode: "edit",
        model,
        initialValues: { status: "draft", title: "Hello" },
        enableWorkflowActions: true,
      },
      global: {
        plugins: [i18n],
        components: {
          InputText: stubComponent("InputText"),
          InputNumber: stubComponent("InputNumber"),
          DatePicker: stubComponent("DatePicker"),
          Checkbox: stubComponent("Checkbox"),
          Select: stubComponent("Select"),
          SelectButton: stubComponent("SelectButton"),
          Card: { name: "Card", template: "<section><slot /></section>" },
          Button: {
            name: "Button",
            props: ["label", "type", "disabled", "loading", "icon", "severity"],
            emits: ["click"],
            template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot>{{ label }}</slot></button>`,
          },
          RichTextEditor: RichTextStub,
          RelationFieldEditor: RelationStub,
        },
        stubs: {
          EntryFormFields: {
            name: "EntryFormFieldsStub",
            template: `<div data-testid="entry-form-fields" />`,
          },
        },
      },
    });

  const mountCreateForm = () =>
    mount(EntryForm, {
      props: {
        mode: "create",
        model,
        initialValues: { status: "draft", title: "" },
      },
      global: {
        plugins: [i18n],
        stubs: {
          Button: {
            name: "Button",
            props: ["label", "type", "disabled", "loading", "icon", "severity"],
            template: `<button :type="type">{{ label }}</button>`,
          },
          EntryFormFields: {
            name: "EntryFormFieldsStub",
            template: `<div data-testid="entry-form-fields" />`,
          },
        },
      },
    });

  const mountListCreateForm = () =>
    mount(EntryForm, {
      props: {
        mode: "create",
        model: {
          id: "model_posts",
          name: "Posts",
          fields: [
            {
              id: "field_scores",
              name: "scores",
              fieldKey: "scores",
              type: "list",
              required: false,
              hasLocales: false,
              isPrivate: false,
              variant: null,
              options: { item: { type: "number" } },
              defaultValue: null,
              position: 0,
              isDisplayTitle: false,
            },
          ],
        },
        initialValues: { status: "draft", scores: [1, null, 2] },
      },
      global: {
        plugins: [i18n],
        stubs: {
          Button: {
            name: "Button",
            props: ["label", "type", "disabled", "loading", "icon", "severity"],
            template: `<button :type="type">{{ label }}</button>`,
          },
          EntryFormFields: {
            name: "EntryFormFieldsStub",
            template: `<div data-testid="entry-form-fields" />`,
          },
        },
      },
    });

  beforeAll(() => {
    // Minimal validators to satisfy vee-validate in tests
    defineRule("required", () => true);
    defineRule("rich_text_required", () => true);
    defineRule("relation_required", () => true);
  });

  it("emits save-draft when Save Draft button is clicked", async () => {
    const wrapper = mountForm();

    const draftButton = wrapper.findAll("button").find((btn) => btn.text() === "Save Draft");
    expect(draftButton?.exists()).toBe(true);

    await draftButton!.trigger("click");
    await flushPromises();

    expect(wrapper.emitted("save-draft")).toBeTruthy();
    expect(wrapper.emitted("save-draft")?.[0]?.[0]).toMatchObject({ title: "Hello" });
  });

  it("emits publish when Publish button is clicked", async () => {
    const wrapper = mountForm();

    const publishButton = wrapper.findAll("button").find((btn) => btn.text() === "Publish");
    expect(publishButton?.exists()).toBe(true);

    await publishButton!.trigger("click");
    await flushPromises();

    expect(wrapper.emitted("publish")).toBeTruthy();
    expect(wrapper.emitted("publish")?.[0]?.[0]).toMatchObject({ title: "Hello" });
  });

  it("labels the create submit action as saving a draft", () => {
    const wrapper = mountCreateForm();

    const submitButton = wrapper.find('button[type="submit"]');
    expect(submitButton.text()).toBe("Save Draft");
  });

  it("normalizes list fields before submit", async () => {
    const wrapper = mountListCreateForm();

    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(wrapper.emitted("submit")?.[0]?.[0]).toMatchObject({
      scores: [1, 2],
    });
  });
});
