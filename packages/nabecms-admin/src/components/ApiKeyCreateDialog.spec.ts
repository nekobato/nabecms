import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ApiKeyCreateDialog from "./ApiKeyCreateDialog.vue";

/**
 * Create an i18n instance for component tests.
 */
const createI18nInstance = () =>
  createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    missingWarn: false,
    fallbackWarn: false,
    messages: { en },
  });

/**
 * Render a lightweight Dialog stub that exposes slots inline.
 */
const DialogStub = defineComponent({
  name: "TestDialogStub",
  props: {
    visible: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => (props.visible ? h("div", { "data-stub": "Dialog" }, [slots.default?.(), slots.footer?.()]) : null);
  },
});

/**
 * Render a minimal InputText stub that supports v-model updates.
 */
const InputTextStub = defineComponent({
  name: "TestInputTextStub",
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

/**
 * Render a minimal checkbox stub that supports boolean v-model updates.
 */
const CheckboxStub = defineComponent({
  name: "TestCheckboxStub",
  props: {
    modelValue: { type: Boolean, default: false },
    inputId: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        id: props.inputId,
        type: "checkbox",
        checked: props.modelValue,
        onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).checked),
      });
  },
});

/**
 * Render a minimal MultiSelect stub that exposes overlay props for assertions.
 */
const MultiSelectStub = defineComponent({
  name: "TestMultiSelectStub",
  props: {
    modelValue: { type: Array, default: () => [] },
    appendTo: { type: String, default: undefined },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs }) {
    return () =>
      h("div", {
        ...attrs,
        "data-stub": "MultiSelect",
        "data-append-to": props.appendTo ?? "",
      });
  },
});

describe("ApiKeyCreateDialog", () => {
  it("requires at least one permission before submit", async () => {
    const wrapper = mount(ApiKeyCreateDialog, {
      props: {
        visible: true,
        models: [{ id: "article", name: "Article" }],
      },
      global: {
        plugins: [createI18nInstance()],
        stubs: {
          Button: true,
          Checkbox: CheckboxStub,
          Dialog: DialogStub,
          InputText: InputTextStub,
          MultiSelect: MultiSelectStub,
          Textarea: true,
        },
      },
    });

    await wrapper.get("#key-name").setValue("Public SDK Key");

    const createButton = wrapper.findAll("button-stub")[1];
    expect(createButton?.attributes("disabled")).toBe("true");

    await wrapper.get("#perm-read").setValue(true);
    expect(createButton?.attributes("disabled")).toBe("false");

    await wrapper.get("#perm-read").setValue(false);
    await wrapper.get("#perm-preview").setValue(false);
    await wrapper.get("#perm-manage").setValue(false);

    expect(wrapper.text()).toContain("Select at least one permission.");
    expect(createButton?.attributes("disabled")).toBe("true");
  });

  it("renders the allowed models overlay outside the dialog clipping container", () => {
    const wrapper = mount(ApiKeyCreateDialog, {
      props: {
        visible: true,
        models: [{ id: "article", name: "Article" }],
      },
      global: {
        plugins: [createI18nInstance()],
        stubs: {
          Button: true,
          Checkbox: CheckboxStub,
          Dialog: DialogStub,
          InputText: InputTextStub,
          MultiSelect: MultiSelectStub,
          Textarea: true,
        },
      },
    });

    expect(wrapper.get('[data-stub="MultiSelect"]').attributes("data-append-to")).toBe("body");
  });
});
