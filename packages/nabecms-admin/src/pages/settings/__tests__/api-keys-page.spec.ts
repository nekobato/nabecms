import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import ApiKeysPage from "../ApiKeysPage.vue";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: (path: string) => ({ href: path }),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: vi.fn() }),
}));

const originalFetch = globalThis.fetch;

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
    return () => h("section", [slots.title?.(), slots.content?.()]);
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
  props: {
    label: { type: String, default: "" },
  },
  setup(props, { attrs }) {
    return () => h("button", attrs, props.label);
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  props: {
    visible: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => (props.visible ? h("div", [slots.default?.(), slots.footer?.()]) : null);
  },
});

const stubs = {
  ApiKeyCreateDialog: true,
  Button: ButtonStub,
  Card: CardStub,
  Dialog: DialogStub,
  PageSectionHeader: PageSectionHeaderStub,
  Tag: TagStub,
};

/**
 * Create an i18n instance for page tests.
 */
const createI18nInstance = () =>
  createI18n({
    legacy: false,
    locale: "ja",
    messages: { ja },
  });

/**
 * Create a JSON-like fetch response for component API mocks.
 */
const createJsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => "",
  }) as Response;

/**
 * Mock the API key page dependencies with model IDs and display names.
 */
const mockApiKeyPageResponses = () => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/admin/models") {
      return createJsonResponse({
        items: [
          { id: "article", name: "記事" },
          { id: "news", name: "ニュース" },
        ],
      });
    }
    if (path === "/api/admin/api-keys") {
      return createJsonResponse({
        items: [
          {
            id: "key_1",
            name: "Content API",
            description: null,
            permissions: ["contents:read"],
            allowedModels: ["article", "news"],
            isRevoked: false,
            createdBy: null,
            revokedBy: null,
            revokedAt: null,
            lastUsedAt: null,
            createdAt: "2026-04-30T08:23:11.000Z",
            updatedAt: "2026-04-30T08:23:11.000Z",
          },
        ],
      });
    }
    return createJsonResponse({}, 404);
  }) as typeof fetch;
};

/**
 * Mount the API keys page with local stubs and authenticated state.
 */
const mountApiKeysPage = () =>
  mount(ApiKeysPage, {
    global: {
      plugins: [createI18nInstance()],
      stubs,
    },
  });

describe("ApiKeysPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
    useAuthStore().$patch({ accessToken: "token_abc" });
    mockApiKeyPageResponses();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders allowed model names instead of model IDs", async () => {
    const wrapper = mountApiKeysPage();

    await flushPromises();

    const allowedModelsRow = wrapper.findAll(".meta > div").find((row) => row.text().includes("許可の限定"));
    expect(allowedModelsRow?.text()).toContain("記事, ニュース");
    expect(allowedModelsRow?.text()).not.toContain("article");
    expect(allowedModelsRow?.text()).not.toContain("news");
  });
});
