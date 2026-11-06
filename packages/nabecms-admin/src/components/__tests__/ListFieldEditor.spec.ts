import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import ListFieldEditor from "../ListFieldEditor.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  props: {
    label: { type: String, default: "" },
    type: { type: String, default: "button" },
  },
  emits: ["click"],
  setup(props, { emit, slots }) {
    return () => h("button", { type: props.type, onClick: () => emit("click") }, slots.default?.() ?? props.label);
  },
});

const InputTextStub = defineComponent({
  name: "InputText",
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        "data-testid": `text-${String(attrs.id)}`,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

const InputNumberStub = defineComponent({
  name: "InputNumber",
  props: {
    modelValue: { type: Number, default: null },
    inputId: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        id: props.inputId,
        value: props.modelValue ?? "",
        "data-testid": `number-${props.inputId}`,
        onInput: (event: Event) => {
          const raw = (event.target as HTMLInputElement).value;
          emit("update:modelValue", raw.trim().length > 0 ? Number(raw) : null);
        },
      });
  },
});

const DatePickerStub = defineComponent({
  name: "DatePicker",
  props: {
    inputId: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          "data-testid": `date-${props.inputId}`,
          onClick: () => emit("update:modelValue", new Date("2026-03-10T00:00:00.000Z")),
        },
        "date",
      );
  },
});

const CheckboxStub = defineComponent({
  name: "CheckboxStub",
  props: {
    modelValue: { type: Boolean, default: false },
    inputId: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h("input", {
        id: props.inputId,
        type: "checkbox",
        checked: props.modelValue,
        "data-testid": `boolean-${props.inputId}`,
        onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).checked),
      });
  },
});

const mountEditor = (props: { modelValue: unknown; itemType: "text" | "number" | "date" | "boolean" }) =>
  mount(ListFieldEditor, {
    props: {
      idBase: "items",
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        Button: ButtonStub,
        InputText: InputTextStub,
        InputNumber: InputNumberStub,
        DatePicker: DatePickerStub,
        Checkbox: CheckboxStub,
      },
    },
  });

describe("ListFieldEditor", () => {
  it("emits number arrays from number rows", async () => {
    const wrapper = mountEditor({ modelValue: [], itemType: "number" });

    await wrapper.get('[data-testid="number-items-0"]').setValue("42");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([[42]]);
  });

  it("emits YYYY-MM-DD strings from date rows", async () => {
    const wrapper = mountEditor({ modelValue: [], itemType: "date" });

    await wrapper.get('[data-testid="date-items-0"]').trigger("click");

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["2026-03-10"]]);
  });

  it("emits boolean arrays from boolean rows", async () => {
    const wrapper = mountEditor({ modelValue: [], itemType: "boolean" });

    await wrapper.get('[data-testid="boolean-items-0"]').setValue(true);

    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([[true]]);
  });
});
