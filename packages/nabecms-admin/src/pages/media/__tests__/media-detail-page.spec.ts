import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, type PropType } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import MediaDetailPage from "../MediaDetailPage.vue";

type BreadcrumbItem = {
  label: string;
};

let mediaId = "GMOWHze97dJI";
const routerPushMock = vi.fn();
const toastAddMock = vi.fn();
const clipboardWriteTextMock = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: { mediaId },
  }),
  useRouter: () => ({
    push: routerPushMock,
    resolve: (path: string) => ({ href: `/admin${path}` }),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

const originalFetch = globalThis.fetch;
const originalClipboard = navigator.clipboard;
const mediaPath = `/api/admin/media/${mediaId}/file`;

/**
 * Create a media detail payload for page tests.
 * @returns Raw media payload
 */
const createMediaItem = () => ({
  id: mediaId,
  groupId: "group_1",
  url: mediaPath,
  type: "image",
  mimeType: "image/png",
  name: "スクリーンショット 2026-05-13 16.24.30.png",
  description: null,
  width: 320,
  height: 180,
  size: 1024,
  status: "published",
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  updatedBy: { id: "user_1", name: "nekobato" },
});

/**
 * Build a fetch mock for media detail and variants requests.
 * @returns Fetch mock
 */
const mockMediaFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.endsWith("/variants")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ item: createMediaItem() }),
    } as Response;
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
};

const PageSectionHeaderStub = defineComponent({
  name: "PageSectionHeaderStub",
  props: {
    title: { type: String, required: true },
    breadcrumbModel: { type: Array as PropType<BreadcrumbItem[]>, default: () => [] },
  },
  setup(props, { slots }) {
    return () =>
      h("header", [
        h(
          "nav",
          { "data-test": "breadcrumb" },
          props.breadcrumbModel.map((item) => h("span", { class: "breadcrumb-item" }, item.label)),
        ),
        h("h1", props.title),
        slots.actions?.(),
      ]);
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  props: {
    label: { type: String, default: "" },
  },
  emits: ["click"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          onClick: () => emit("click"),
        },
        props.label,
      );
  },
});

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("section", [slots.header?.(), slots.content?.()]);
  },
});

const ElTableStub = defineComponent({
  name: "ElTableStub",
  setup(_props, { slots }) {
    return () => h("div", slots.default?.());
  },
});

const stubs = {
  Button: ButtonStub,
  Card: CardStub,
  ElTable: ElTableStub,
  ElTableColumn: true,
  InputText: true,
  PageSectionHeader: PageSectionHeaderStub,
  Select: true,
  Tag: true,
  Textarea: true,
};

/**
 * Mount the media detail page with shared test plugins.
 * @returns Mounted wrapper
 */
const mountMediaDetailPage = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.$patch({ accessToken: "token_abc" });

  return mount(MediaDetailPage, {
    global: {
      plugins: [
        pinia,
        createI18n({
          legacy: false,
          locale: "ja",
          missingWarn: false,
          fallbackWarn: false,
          messages: { ja },
        }),
      ],
      stubs,
    },
  });
};

describe("MediaDetailPage", () => {
  beforeEach(() => {
    mediaId = "GMOWHze97dJI";
    routerPushMock.mockReset();
    toastAddMock.mockReset();
    clipboardWriteTextMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
    mockMediaFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it.each(["../models/victim?", "victim#", "%2e%2e", "media_legacy"])("preserves media identity for direct authenticated requests with ID %j", async (id) => {
    mediaId = id;
    const requests: Array<{ url: URL; method: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "https://cms.example.test");
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token_abc");
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify(url.pathname.endsWith("/variants") ? { items: [] } : { item: createMediaItem() }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mountMediaDetailPage();
    try {
      await flushPromises();
      const page = wrapper.vm as unknown as {
        handleUpdate: (values: Record<string, unknown>) => Promise<void>;
        deleteMedia: () => Promise<void>;
      };
      await page.handleUpdate({ name: "Media", description: "Updated", status: "published" });
      await page.deleteMedia();
      expect(requests.map(({ method }) => method)).toEqual(["GET", "GET", "PUT", "DELETE"]);
      for (const { url } of requests) {
        const path = `/api/admin/media/${encodeURIComponent(id)}`;
        expect([path, `${path}/variants`]).toContain(url.pathname);
        expect(url.search).toBe("");
        expect(url.hash).toBe("");
      }
    } finally {
      wrapper.unmount();
      confirmation.mockRestore();
    }
  });

  it("renders the media id in the detail breadcrumb instead of the fetched file name", async () => {
    const wrapper = mountMediaDetailPage();
    await flushPromises();

    const breadcrumbText = wrapper.get('[data-test="breadcrumb"]').text();

    expect(breadcrumbText).toContain(mediaId);
    expect(breadcrumbText).not.toContain("スクリーンショット 2026-05-13 16.24.30.png");
  });

  it("renders an absolute accessible URL in the metadata section", async () => {
    const wrapper = mountMediaDetailPage();
    await flushPromises();

    const accessibleUrl = new URL(mediaPath, window.location.origin).href;

    expect(wrapper.get(".url-text").text()).toBe(accessibleUrl);
  });

  it("keeps technical file properties in the main file information section", async () => {
    const wrapper = mountMediaDetailPage();
    await flushPromises();

    const fileInfoSectionText = wrapper.get(".info-section").text();

    expect(wrapper.text()).not.toContain("技術仕様");
    expect(fileInfoSectionText).toContain("ファイル名");
    expect(fileInfoSectionText).toContain("ステータス");
    expect(fileInfoSectionText).toContain("ファイルサイズ");
    expect(fileInfoSectionText).toContain("MIMEタイプ");
  });

  it("copies the absolute accessible URL", async () => {
    const wrapper = mountMediaDetailPage();
    await flushPromises();

    const accessibleUrl = new URL(mediaPath, window.location.origin).href;
    const copyButton = wrapper.findAll("button").find((button) => button.text() === "URLコピー");
    expect(copyButton).toBeDefined();

    await copyButton?.trigger("click");

    expect(clipboardWriteTextMock).toHaveBeenCalledWith(accessibleUrl);
  });
});
