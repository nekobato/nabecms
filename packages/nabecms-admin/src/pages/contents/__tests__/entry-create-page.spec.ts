import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent, h, reactive, type PropType } from "vue";
import EntryCreatePage from "../EntryCreatePage.vue";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";

const pushMock = vi.fn();
const backMock = vi.fn();
const toastAddMock = vi.fn();
const routeParams = reactive<{ modelId: string }>({ modelId: "model_posts" });

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

const BreadcrumbStub = defineComponent({
  name: "BreadcrumbStub",
  props: {
    model: {
      type: Array as PropType<Array<{ label: string; route?: string }>>,
      default: () => [],
    },
  },
  setup(props) {
    return () => h("nav", props.model?.map((item) => item.label).join(" / "));
  },
});

const EntryFormStub = defineComponent({
  name: "EntryFormStub",
  props: {
    model: { type: Object, required: true },
    initialValues: { type: Object, required: true },
    locales: { type: Array, default: () => [] },
    defaultLocale: { type: String, default: "en" },
    loading: { type: Boolean, default: false },
    mode: { type: String, default: "create" },
  },
  emits: ["submit", "cancel"],
  setup(props, { emit }) {
    return () =>
      h(
        "form",
        {
          onSubmit: (event: Event) => {
            event.preventDefault();
            emit("submit", {
              status: "draft",
              title: { "ja-JP": "Sample title" },
              body: {
                "ja-JP": {
                  type: "rich_text",
                  value: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }] },
                },
              },
              featured: true,
            });
          },
        },
        [h("button", { type: "submit" }, "submit")],
      );
  },
});

const stubs = {
  Breadcrumb: BreadcrumbStub,
  EntryForm: EntryFormStub,
  Card: defineComponent({
    name: "CardStub",
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
};

const originalFetch = globalThis.fetch;

function mockFetchSequence(responses: Array<{ status: number; ok: boolean; body: unknown }>) {
  globalThis.fetch = vi.fn().mockImplementation(async () => {
    const next = responses.shift();
    if (!next) throw new Error("No more mock responses");
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    } as Response;
  });
}

describe("EntryCreatePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    pushMock.mockReset();
    backMock.mockReset();
    toastAddMock.mockReset();
    setActivePinia(createPinia());
    const store = useAuthStore();
    store.$patch({ accessToken: "token_abc" });
  });

  it("fetches model data and creates entry via API", async () => {
    mockFetchSequence([
      {
        status: 200,
        ok: true,
        body: {
          item: {
            id: "model_posts",
            name: "Posts",
            description: null,
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            fieldsCount: 3,
            entriesCount: 0,
          },
        },
      },
      {
        status: 200,
        ok: true,
        body: [
          {
            id: "field_title",
            name: "title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: true,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: null,
            position: 0,
            isDisplayTitle: true,
          },
          {
            id: "field_body",
            name: "body",
            fieldKey: "body",
            type: "rich_text",
            required: true,
            hasLocales: true,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: null,
            position: 1,
            isDisplayTitle: false,
          },
          {
            id: "field_featured",
            name: "featured",
            fieldKey: "featured",
            type: "boolean",
            required: false,
            hasLocales: false,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: null,
            position: 2,
            isDisplayTitle: false,
          },
        ],
      },
      {
        status: 200,
        ok: true,
        body: { items: [{ code: "ja-JP", isDefault: true }] },
      },
      {
        status: 201,
        ok: true,
        body: {
          item: {
            id: "entry_1",
            modelId: "model_posts",
            title: "Sample title",
            status: "draft",
            createdAt: "2025-09-26T12:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            publishedAt: null,
          },
        },
      },
    ]);

    const wrapper = mount(EntryCreatePage, {
      global: {
        plugins: [
          createI18n({
            legacy: false,
            locale: "ja",
            messages: { ja },
          }),
        ],
        stubs,
      },
    });

    await flushPromises();

    expect(wrapper.get(".page-section-header__title").text()).toBe("Posts");
    expect(wrapper.get(".page-section-header__title-icon").exists()).toBe(true);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, "/api/admin/models/model_posts", expect.any(Object));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "/api/admin/models/model_posts/fields", expect.any(Object));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(3, "/api/admin/locales", expect.any(Object));
    const entryForm = wrapper.findComponent(EntryFormStub);
    expect(entryForm.props("locales")).toEqual([{ code: "ja-JP", isDefault: true }]);
    expect(entryForm.props("defaultLocale")).toBe("ja-JP");

    await wrapper.find("form").trigger("submit.prevent");
    await flushPromises();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      "/api/admin/models/model_posts/entries",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const fetchMock = globalThis.fetch as unknown as Mock<[RequestInfo | URL, RequestInit?], Promise<Response>>;
    const payloadRaw = fetchMock.mock.calls[3]?.[1]?.body as string | undefined;
    const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
    expect(payload.status).toBe("draft");
    expect(payload.fields).toEqual([
      expect.objectContaining({ fieldId: "field_title", value: "Sample title", locale: "ja-JP" }),
      expect.objectContaining({ fieldId: "field_body", locale: "ja-JP" }),
      expect.objectContaining({ fieldId: "field_featured", value: true, locale: "ja-JP" }),
    ]);

    expect(pushMock).toHaveBeenCalledWith("/contents/model_posts");
    expect(toastAddMock).toHaveBeenCalled();
  });
});
