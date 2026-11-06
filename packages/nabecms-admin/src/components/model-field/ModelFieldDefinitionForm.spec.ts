import { describe, expect, it, vi, beforeEach } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import { useFieldDefinitionForm } from "./add-field/useFieldDefinitionForm";
import ModelFieldDefinitionForm from "./ModelFieldDefinitionForm.vue";

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    accessToken: "token",
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/utils/http", () => ({
  authorizedFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ items: [{ id: "article", name: "Article" }] }),
    text: async () => "",
  })),
}));

const t = (key: string) => key;

const primeStub = (name: string) =>
  defineComponent({
    name,
    props: {
      modelValue: { type: [Array, Object, String, Number, Boolean], default: undefined },
      options: { type: Array, default: undefined },
    },
    emits: ["update:modelValue"],
    setup(_, { attrs }) {
      return () => h("div", { "data-stub": name, ...attrs });
    },
  });

describe("ModelFieldDefinitionForm relation options", () => {
  const createI18nInstance = () =>
    createI18n({
      legacy: false,
      locale: "en",
      fallbackLocale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: { en: {} },
    });

  const stubs = {
    Checkbox: primeStub("Checkbox"),
    InputNumber: primeStub("InputNumber"),
    InputText: primeStub("InputText"),
    Select: primeStub("Select"),
    SelectButton: primeStub("SelectButton"),
    Textarea: primeStub("Textarea"),
    MultiSelect: primeStub("MultiSelect"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render removed relation limit controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("relation");
    await nextTick();
    api.form.name = "Relation";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#relation-min").exists()).toBe(false);
    expect(wrapper.find("#relation-max").exists()).toBe(false);

    api.form.variant = "many";
    await nextTick();
    await nextTick();

    expect(wrapper.find("#relation-min").exists()).toBe(false);
    expect(wrapper.find("#relation-max").exists()).toBe(false);

    api.form.variant = "one";
    await nextTick();
    await nextTick();

    expect(wrapper.find("#relation-min").exists()).toBe(false);
    expect(wrapper.find("#relation-max").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render removed text option controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("text");
    await nextTick();
    api.form.name = "Title";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#text-min-length").exists()).toBe(false);
    expect(wrapper.find("#text-max-length").exists()).toBe(false);
    expect(wrapper.find("#text-pattern").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render removed date restriction controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("date");
    await nextTick();
    api.form.name = "Published At";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.text()).not.toContain("models.detail.add_field_dialog.options_heading_date");
    expect(wrapper.find("#date-min").exists()).toBe(false);
    expect(wrapper.find("#date-max").exists()).toBe(false);
    expect(wrapper.find("#date-restrict").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render removed media constraint controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("media");
    await nextTick();
    api.form.name = "Hero";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#media-mime").exists()).toBe(false);
    expect(wrapper.find("#media-max-size").exists()).toBe(false);
    expect(wrapper.find("#media-alt").exists()).toBe(false);
    expect(wrapper.find("#media-image-min-width").exists()).toBe(false);
    expect(wrapper.find("#media-image-min-height").exists()).toBe(false);
    expect(wrapper.find("#media-image-max-width").exists()).toBe(false);
    expect(wrapper.find("#media-image-max-height").exists()).toBe(false);
    expect(wrapper.find("#media-image-aspect").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render removed boolean null-state controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("boolean");
    await nextTick();
    api.form.name = "Featured";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#boolean-tristate").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render number option controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("number");
    await nextTick();
    api.form.name = "Score";
    api.form.variant = "decimal";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#number-min").exists()).toBe(false);
    expect(wrapper.find("#number-max").exists()).toBe(false);
    expect(wrapper.find("#number-step").exists()).toBe(false);
    expect(wrapper.find("#number-precision").exists()).toBe(false);
    expect(wrapper.find("#number-scale").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render list date item option controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("list");
    await nextTick();
    api.form.name = "Date List";
    api.optionsState.list.itemType = "date";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#list-date-format").exists()).toBe(false);
    expect(wrapper.find("#list-date-min").exists()).toBe(false);
    expect(wrapper.find("#list-date-max").exists()).toBe(false);
    expect(wrapper.find("#list-date-restrict").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render list text item option controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("list");
    await nextTick();
    api.form.name = "Text List";
    api.optionsState.list.itemType = "text";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#list-text-min-length").exists()).toBe(false);
    expect(wrapper.find("#list-text-max-length").exists()).toBe(false);
    expect(wrapper.find("#list-text-pattern").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render removed list boolean null-state controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("list");
    await nextTick();
    api.form.name = "Boolean List";
    api.optionsState.list.itemType = "boolean";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#list-boolean-tristate").exists()).toBe(false);

    wrapper.unmount();
  });

  it("does not render list number item option controls", async () => {
    const api = useFieldDefinitionForm(t, ref(true));
    api.handleSelectType("list");
    await nextTick();
    api.form.name = "Number List";
    api.optionsState.list.itemType = "number";
    await nextTick();

    const wrapper = mount(ModelFieldDefinitionForm, {
      props: { api },
      global: { stubs, plugins: [createI18nInstance()] },
    });

    await nextTick();

    expect(wrapper.find("#list-number-min").exists()).toBe(false);
    expect(wrapper.find("#list-number-max").exists()).toBe(false);
    expect(wrapper.find("#list-number-step").exists()).toBe(false);
    expect(wrapper.find("#list-number-precision").exists()).toBe(false);
    expect(wrapper.find("#list-number-scale").exists()).toBe(false);

    wrapper.unmount();
  });
});
