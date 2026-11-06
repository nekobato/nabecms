import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, inject, provide } from "vue";
import type { PropType } from "vue";
import { describe, expect, it } from "vitest";
import ja from "@/locales/ja.json";
import ModelFieldsTable from "./ModelFieldsTable.vue";
import type { ModelField } from "@/pages/models/model-detail-types";

const TagStub = defineComponent({
  name: "TagStub",
  props: {
    value: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", { class: "tag-stub" }, props.value);
  },
});

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("section", [slots.header?.(), slots.content?.()]);
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  props: {
    icon: { type: String, default: "" },
    label: { type: String, default: "" },
    severity: { type: String, default: "" },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    rounded: { type: Boolean, default: false },
    text: { type: Boolean, default: false },
  },
  emits: ["click"],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          "data-icon": props.icon,
          "data-severity": props.severity,
          "data-loading": String(props.loading),
          "data-rounded": String(props.rounded),
          "data-text": String(props.text),
          disabled: props.disabled,
          onClick: () => emit("click"),
        },
        props.label,
      );
  },
});

const CheckboxStub = defineComponent({
  name: "CheckboxStub",
  setup() {
    return () => h("input", { type: "checkbox" });
  },
});

const tableRowsKey = Symbol("tableRows");

const ElTableStub = defineComponent({
  name: "ElTable",
  props: {
    data: { type: Array as PropType<ModelField[]>, default: () => [] },
  },
  setup(props, { slots }) {
    provide(tableRowsKey, props.data);
    return () => h("div", { class: "table-stub" }, slots.default?.());
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumn",
  props: {
    className: { type: String, default: "" },
  },
  setup(props, { slots }) {
    const rows = inject<ModelField[]>(tableRowsKey, []);
    return () =>
      h(
        "div",
        {
          class: ["column-stub", props.className],
        },
        slots.default ? rows.map((field) => h("div", { class: "column-body", key: field.id }, slots.default?.({ row: field }))) : undefined,
      );
  },
});

const VueDraggableStub = defineComponent({
  name: "VueDraggable",
  props: {
    modelValue: { type: Array as PropType<ModelField[]>, default: () => [] },
    customUpdate: { type: Function as PropType<(event: { oldIndex: number; newIndex: number }) => void>, required: true },
  },
  setup(_props, { slots }) {
    return () => h("div", { class: "draggable-stub" }, slots.default?.());
  },
});

const tableStubs = {
  ElTable: ElTableStub,
  ElTableColumn: ElTableColumnStub,
  VueDraggable: VueDraggableStub,
  Tag: TagStub,
  Card: CardStub,
  Button: ButtonStub,
  Checkbox: CheckboxStub,
};

const createField = (overrides: Partial<ModelField> = {}): ModelField => ({
  id: "field_title",
  name: "Title",
  fieldKey: "title",
  type: "text",
  required: true,
  hasLocales: false,
  isPrivate: false,
  isUnique: true,
  variant: "shortText",
  options: null,
  defaultValue: null,
  position: 0,
  isDisplayTitle: false,
  ...overrides,
});

describe("ModelFieldsTable", () => {
  it("renders field variant as a tag", () => {
    const wrapper = mount(ModelFieldsTable, {
      props: {
        fields: [createField()],
        hasUnsavedOrderChanges: false,
        applyingOrder: false,
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })],
        stubs: tableStubs,
      },
    });

    expect(wrapper.text()).toContain("text");
    expect(wrapper.text()).toContain("短文");
    expect(wrapper.text()).toContain("必須");
    expect(wrapper.text()).toContain("一意");
    expect(wrapper.text()).toContain("公開");
  });

  it("shows the row reorder handle and emits reorder events outside inline editing", () => {
    const baseProps = {
      fields: [createField(), createField({ id: "field_body", name: "Body", fieldKey: "body", position: 1 })],
      hasUnsavedOrderChanges: false,
      applyingOrder: false,
    };
    const mountTable = (editingInline: boolean) =>
      mount(ModelFieldsTable, {
        props: {
          ...baseProps,
          editingInline,
        },
        global: {
          plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })],
          stubs: tableStubs,
        },
      });

    const viewModeWrapper = mountTable(false);
    const viewModeDraggable = viewModeWrapper.findComponent(VueDraggableStub);
    expect(viewModeWrapper.find(".field-row-drag-handle").exists()).toBe(true);

    viewModeDraggable.props("customUpdate")({ oldIndex: 0, newIndex: 1 });
    expect(viewModeWrapper.emitted("row-reorder")).toHaveLength(1);
    expect(viewModeWrapper.emitted("row-reorder")?.[0]?.[0]).toEqual([...baseProps.fields].reverse());
    expect(baseProps.fields.map((field) => field.id)).toEqual(["field_title", "field_body"]);

    const editModeWrapper = mountTable(true);
    const editModeDraggable = editModeWrapper.findComponent(VueDraggableStub);
    expect(editModeWrapper.find(".field-row-drag-handle").exists()).toBe(true);

    editModeDraggable.props("customUpdate")({ oldIndex: 0, newIndex: 1 });
    expect(editModeWrapper.emitted("row-reorder")).toHaveLength(1);
  });

  it("renders field actions as borderless icon buttons", async () => {
    const wrapper = mount(ModelFieldsTable, {
      props: {
        fields: [createField()],
        hasUnsavedOrderChanges: false,
        applyingOrder: false,
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })],
        stubs: tableStubs,
      },
    });

    const editButton = wrapper.get(".edit-field-button");
    expect(editButton.attributes("data-text")).toBe("true");
    expect(editButton.attributes("data-rounded")).toBe("true");
    expect(editButton.attributes("data-icon")).toBe("lucide:pencil");
    expect(editButton.attributes("aria-label")).toBe("編集");
    expect(editButton.text()).toBe("");

    const deleteButton = wrapper.get(".delete-field-button");
    expect(deleteButton.attributes("data-text")).toBe("true");
    expect(deleteButton.attributes("data-rounded")).toBe("true");
    expect(deleteButton.attributes("data-icon")).toBe("lucide:trash-2");
    expect(deleteButton.attributes("data-severity")).toBe("danger");
    expect(deleteButton.attributes("aria-label")).toBe("フィールド削除");
    expect(deleteButton.text()).toBe("");

    await deleteButton.trigger("click");
    expect(wrapper.emitted("delete-field")?.[0]).toEqual(["field_title"]);
  });

  it("disables the field delete button while the field is deleting", () => {
    const wrapper = mount(ModelFieldsTable, {
      props: {
        fields: [createField()],
        hasUnsavedOrderChanges: false,
        applyingOrder: false,
        deletingFieldIds: { field_title: true },
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })],
        stubs: tableStubs,
      },
    });

    const deleteButton = wrapper.get(".delete-field-button");
    expect(deleteButton.attributes("data-loading")).toBe("true");
    expect(deleteButton.attributes("disabled")).toBeDefined();
  });
});
