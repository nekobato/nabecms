import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import en from "../../../locales/en.json";
import ja from "../../../locales/ja.json";
import UsersInviteSection from "../UsersInviteSection.vue";

const toastAddMock = vi.fn();
const authorizedFetchMock = vi.fn();

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    accessToken: "token",
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/utils/http", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("div", [...(slots.title?.() ?? []), ...(slots.content?.() ?? [])]);
  },
});

const ElTableStub = defineComponent({
  name: "ElTableStub",
  setup(_props, { slots }) {
    return () => h("div", { "data-stub": "ElTable" }, slots.default?.());
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumnStub",
  setup(_props, { slots }) {
    return () => h("div", slots.default?.());
  },
});

const TagStub = defineComponent({
  name: "TagStub",
  props: {
    value: { type: String, default: "" },
  },
  setup(props) {
    return () => h("span", props.value);
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  emits: ["click"],
  setup(_props, { attrs, emit }) {
    return () => h("button", { ...attrs, type: "button", onClick: () => emit("click") }, String(attrs.label ?? ""));
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  inheritAttrs: false,
  props: { visible: { type: Boolean, default: false } },
  setup(props, { attrs, slots }) {
    return () => (props.visible ? h("div", attrs, [slots.default?.(), slots.footer?.()]) : null);
  },
});

const InputTextStub = defineComponent({
  name: "InputTextStub",
  inheritAttrs: false,
  props: { modelValue: { type: String, default: "" } },
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

const SelectStub = defineComponent({
  name: "SelectStub",
  setup(_props, { attrs }) {
    return () => h("select", attrs);
  },
});

/**
 * Install browser breakpoint support expected by responsive dialogs.
 */
const installMatchMediaMock = () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

/**
 * Mount the invite section with production i18n messages and Element Plus overlays.
 */
const mountComponent = () => {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    messages: { en, ja },
  });

  return mount(UsersInviteSection, {
    attachTo: document.body,
    props: {
      roles: [{ id: "role_admin", name: "Admin", description: null, isSystem: false }],
    },
    global: {
      plugins: [i18n],
      stubs: {
        Button: ButtonStub,
        Card: CardStub,
        ElTable: ElTableStub,
        ElTableColumn: ElTableColumnStub,
        Dialog: DialogStub,
        InputText: InputTextStub,
        Select: SelectStub,
        Tag: TagStub,
      },
    },
  });
};

describe("UsersInviteSection i18n integration", () => {
  beforeEach(() => {
    installMatchMediaMock();
    authorizedFetchMock.mockReset();
    toastAddMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the invite dialog with literal email placeholders compiled by vue-i18n", async () => {
    authorizedFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      async json() {
        return { items: [] };
      },
    });

    const wrapper = mountComponent();
    await flushPromises();

    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    await flushPromises();

    expect(wrapper.find(".invite-dialog").exists()).toBe(true);
    expect(wrapper.get<HTMLInputElement>("#invite-email").attributes("placeholder")).toBe("user@example.com");
  });
});
