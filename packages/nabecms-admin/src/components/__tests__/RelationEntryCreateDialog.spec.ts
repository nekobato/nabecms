import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

import RelationEntryCreateDialog from "../RelationEntryCreateDialog.vue";

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  emits: ["click"],
  setup(_, { emit, slots, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: typeof attrs.type === "string" ? attrs.type : "button",
          "data-stub": "Button",
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default?.() ?? (typeof attrs.label === "string" ? attrs.label : ""),
      );
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  inheritAttrs: false,
  props: {
    visible: { type: Boolean, default: false },
  },
  emits: ["update:visible", "hide"],
  setup(props, { emit, slots, attrs }) {
    return () =>
      props.visible
        ? h("div", { ...attrs, "data-stub": "Dialog" }, [
            slots.default?.(),
            slots.footer?.(),
            h(
              "button",
              {
                type: "button",
                "data-test": "dialog-close",
                onClick: () => {
                  emit("update:visible", false);
                  emit("hide");
                },
              },
              "close",
            ),
          ])
        : null;
  },
});

vi.mock("@/components/EntryForm.vue", async () => {
  const vue = await import("vue");
  const component = vue.defineComponent({
    name: "EntryForm",
    props: {
      model: { type: Object, required: true },
      initialValues: { type: Object, required: true },
      loading: { type: Boolean, default: false },
      mode: { type: String, required: true },
      locales: { type: Array, default: () => [] },
      defaultLocale: { type: String, default: "en" },
      localeFilter: { type: String, default: "all" },
    },
    emits: ["submit", "cancel"],
    setup(props, { emit }) {
      return () =>
        vue.h("div", { "data-test": "entry-form-stub", "data-default-locale": props.defaultLocale, "data-locale-filter": props.localeFilter }, [
          vue.h(
            "button",
            {
              type: "button",
              "data-test": "entry-form-submit",
              onClick: () => emit("submit", { status: "draft", title: "Created title" }),
            },
            "submit",
          ),
        ]);
    },
  });
  return {
    default: component,
    name: "EntryForm",
    __isTeleport: false,
    __isKeepAlive: false,
    __isSuspense: false,
  };
});

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key;
      return Object.entries(params).reduce((message, [name, value]) => message.replace(`{${name}}`, String(value)), key);
    },
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    accessToken: "token",
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

const authorizedFetchMock = vi.fn();
vi.mock("@/utils/http", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

const createResponse = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status >= 200 && status < 300 ? "OK" : "Error",
  async json() {
    return data;
  },
  async text() {
    return typeof data === "string" ? data : JSON.stringify(data);
  },
});

type DialogMountProps = {
  locales?: Array<{ code: string; isDefault?: boolean }>;
  defaultLocale?: string;
  localeFilter?: string;
};

const mountDialog = (props: DialogMountProps = {}) =>
  mount(RelationEntryCreateDialog, {
    props: {
      visible: true,
      modelId: "article",
      modelName: "Article",
      ...props,
    },
    global: {
      stubs: {
        Button: ButtonStub,
        Dialog: DialogStub,
      },
    },
  });

describe("RelationEntryCreateDialog", () => {
  beforeEach(() => {
    authorizedFetchMock.mockReset();
  });

  it("loads the target model and creates a draft entry", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown, init?: RequestInit) => {
      if (input === "/api/admin/models/article") {
        return createResponse({ item: { id: "article", name: "Article" } });
      }
      if (input === "/api/admin/models/article/fields") {
        return createResponse([
          {
            id: "field_title",
            name: "title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: null,
            defaultValue: "",
            position: 0,
            isDisplayTitle: true,
          },
        ]);
      }
      if (input === "/api/admin/models/article/entries" && init?.method === "POST") {
        return createResponse(
          {
            item: {
              id: "entry-new",
              modelId: "article",
              status: "draft",
              updatedAt: "2026-05-15T00:00:00.000Z",
            },
          },
          201,
        );
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const wrapper = mountDialog({
      locales: [{ code: "ja", isDefault: true }],
      defaultLocale: "ja",
      localeFilter: "ja",
    });
    await flushPromises();

    expect(wrapper.find('[data-test="entry-form-stub"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="entry-form-stub"]').attributes("data-default-locale")).toBe("ja");
    expect(wrapper.find('[data-test="entry-form-stub"]').attributes("data-locale-filter")).toBe("ja");
    await wrapper.find('[data-test="entry-form-submit"]').trigger("click");
    await flushPromises();

    const postCall = authorizedFetchMock.mock.calls.find(([, input]) => input === "/api/admin/models/article/entries");
    expect(postCall).toBeDefined();
    const init = postCall?.[2] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      status: "draft",
      fields: [{ fieldId: "field_title", locale: "ja", value: "Created title" }],
    });
    expect(wrapper.emitted("created")?.[0]).toEqual([
      {
        id: "entry-new",
        modelId: "article",
        status: "draft",
        updatedAt: "2026-05-15T00:00:00.000Z",
      },
    ]);
    expect(wrapper.emitted("update:visible")?.at(-1)).toEqual([false]);
  });
});
