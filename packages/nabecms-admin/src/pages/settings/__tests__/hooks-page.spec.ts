import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import type { PropType } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import HooksPage from "../HooksPage.vue";

const toastAddMock = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: (path: string) => ({ href: path }),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

vi.mock("@/utils/http", () => ({
  authorizedFetch: vi.fn(),
}));

const PageSectionHeaderStub = defineComponent({
  name: "PageSectionHeaderStub",
  props: {
    title: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => h("header", [h("h1", props.title), slots.actions?.()]);
  },
});

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("section", slots.content?.());
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  emits: ["click"],
  setup(_props, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          disabled: attrs.disabled === true,
          type: "button",
          onClick: () => emit("click"),
        },
        slots.default?.() ?? (typeof attrs.label === "string" ? attrs.label : ""),
      );
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  inheritAttrs: false,
  props: {
    header: { type: String, default: "" },
    visible: { type: Boolean, default: false },
  },
  emits: ["update:visible"],
  setup(props, { slots }) {
    return () => (props.visible ? h("section", { "data-stub": "Dialog" }, [h("h2", props.header), slots.default?.(), slots.footer?.()]) : null);
  },
});

const InputTextStub = defineComponent({
  name: "InputTextStub",
  inheritAttrs: false,
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

const TextareaStub = defineComponent({
  name: "TextareaStub",
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
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
      });
  },
});

const MultiSelectStub = defineComponent({
  name: "MultiSelectStub",
  inheritAttrs: false,
  props: {
    modelValue: { type: Array as PropType<string[]>, default: () => [] },
    options: { type: Array as PropType<string[]>, default: () => [] },
    placeholder: { type: String, default: "" },
  },
  setup(props, { attrs }) {
    return () =>
      h(
        "select",
        { ...attrs, multiple: true, "aria-label": props.placeholder },
        props.options.map((option) => h("option", { value: option, selected: props.modelValue.includes(option) }, option)),
      );
  },
});

const InputSwitchStub = defineComponent({
  name: "InputSwitchStub",
  inheritAttrs: false,
  props: {
    modelValue: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        checked: props.modelValue,
        type: "checkbox",
        onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).checked),
      });
  },
});

const stubs = {
  Button: ButtonStub,
  Card: CardStub,
  ElTable: true,
  ElTableColumn: true,
  Dialog: DialogStub,
  InputSwitch: InputSwitchStub,
  InputText: InputTextStub,
  MultiSelect: MultiSelectStub,
  PageSectionHeader: PageSectionHeaderStub,
  Skeleton: true,
  Tag: true,
  Textarea: TextareaStub,
};

const authorizedFetchMock = vi.mocked(authorizedFetch);

const jsonResponse = (body: unknown) =>
  ({
    json: async () => body,
    ok: true,
    status: 200,
  }) as Response;

const mountPage = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({ accessToken: "token_abc" });

  return mount(HooksPage, {
    global: {
      plugins: [
        pinia,
        createI18n({
          fallbackLocale: "en",
          legacy: false,
          locale: "ja",
          messages: { en, ja },
        }),
      ],
      stubs,
    },
  });
};

describe("HooksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizedFetchMock.mockResolvedValue(jsonResponse({ items: [] }));
  });

  it("opens the create dialog in Japanese locale", async () => {
    const wrapper = mountPage();
    await flushPromises();

    const createButton = wrapper.findAll("button").find((button) => button.text() === "新規作成");
    expect(createButton).toBeDefined();

    await createButton?.trigger("click");

    expect(wrapper.find('[data-stub="Dialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("送信先URL");
    expect(wrapper.text()).toContain("本文テンプレート");
    expect(wrapper.text()).toContain("イベント");
    expect(wrapper.text()).toContain("保存");
    expect(wrapper.text()).not.toContain("common.save");
  });
});
