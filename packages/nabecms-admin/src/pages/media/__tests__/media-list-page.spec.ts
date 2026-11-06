import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import MediaListPage from "../MediaListPage.vue";

const routerPushMock = vi.fn();
const toastAddMock = vi.fn();
const fetchFailedVariantsMock = vi.fn();
const fetchMediaSettingsMock = vi.fn();

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

vi.mock("@/services/mediaSettings", () => ({
  fetchFailedVariants: (...args: unknown[]) => fetchFailedVariantsMock(...args),
  fetchMediaSettings: (...args: unknown[]) => fetchMediaSettingsMock(...args),
}));

const originalFetch = globalThis.fetch;
const urlObjectUrlMethods = URL as typeof URL & {
  createObjectURL?: (object: Blob | MediaSource) => string;
  revokeObjectURL?: (url: string) => void;
};
const originalCreateObjectURL = urlObjectUrlMethods.createObjectURL;
const originalRevokeObjectURL = urlObjectUrlMethods.revokeObjectURL;

/**
 * Stub preview URL methods used by image file selection.
 */
const mockPreviewObjectUrls = () => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
};

/**
 * Restore preview URL methods after tests mutate them.
 */
const restorePreviewObjectUrls = () => {
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
  } else {
    delete urlObjectUrlMethods.createObjectURL;
  }

  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  } else {
    delete urlObjectUrlMethods.revokeObjectURL;
  }
};

/**
 * Create a media record for list page tests.
 * @param id - Media identifier
 * @returns Raw media payload
 */
const createMediaItem = (id: string) => ({
  id,
  groupId: "group_1",
  url: `/api/admin/media/${id}/file`,
  type: "image",
  mimeType: "image/png",
  name: `${id}.png`,
  description: null,
  width: 320,
  height: 180,
  size: 1024,
  status: "published",
  createdAt: "2026-05-07T00:00:00.000Z",
  updatedAt: "2026-05-07T00:00:00.000Z",
  updatedBy: { id: "user_1", name: "nekobato" },
  variantCount: 1,
});

/**
 * Build a fetch mock that returns page-aware media payloads.
 * @returns Fetch mock
 */
const mockMediaFetch = () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const parsed = new URL(url, "http://localhost");
    const offset = Number(parsed.searchParams.get("offset") ?? 0);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [createMediaItem(`media_${offset}`)],
        total: 25,
        limit: Number(parsed.searchParams.get("limit") ?? 12),
        offset,
      }),
    } as Response;
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
};

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
  emits: ["click"],
  setup(_props, { emit, slots }) {
    return () =>
      h(
        "article",
        {
          class: "media-card",
          onClick: () => emit("click"),
        },
        slots.content?.(),
      );
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

const DialogStub = defineComponent({
  name: "DialogStub",
  props: {
    visible: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => (props.visible ? h("section", { class: "dialog-stub" }, [slots.default?.(), h("footer", slots.footer?.())]) : null);
  },
});

const SelectStub = defineComponent({
  name: "SelectStub",
  props: {
    modelValue: { type: String, default: "" },
    options: { type: Array, default: () => [] },
    optionLabel: { type: String, default: "label" },
    optionValue: { type: String, default: "value" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h(
        "select",
        {
          ...attrs,
          value: props.modelValue,
          onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
        },
        (props.options as Array<Record<string, unknown>>).map((option) =>
          h("option", { value: option[props.optionValue] as string }, String(option[props.optionLabel] ?? "")),
        ),
      );
  },
});

const ElUploadStub = defineComponent({
  name: "ElUploadStub",
  props: {
    onChange: { type: Function, default: undefined },
  },
  setup(props, { expose, slots }) {
    const selectedFiles = ref<File[]>([]);

    const clearFiles = () => {
      selectedFiles.value = [];
    };
    const selectFiles = (files: File[]) => {
      selectedFiles.value = files;
      const uploadFiles = files.map((raw, index) => ({ name: raw.name, uid: index + 1, raw }));
      props.onChange?.(uploadFiles.at(-1), uploadFiles);
    };
    expose({ clearFiles });

    return () =>
      h("div", { class: "file-upload-stub" }, [
        slots.default?.(),
        slots.tip?.(),
        h(
          "button",
          {
            type: "button",
            "data-test": "select-image-file",
            onClick: () => {
              selectFiles([new File(["image"], "sample.png", { type: "image/png" })]);
            },
          },
          "select image",
        ),
        h(
          "button",
          {
            type: "button",
            "data-test": "select-multiple-files",
            onClick: () => {
              selectFiles([new File(["first"], "first.pdf", { type: "application/pdf" }), new File(["second"], "second.pdf", { type: "application/pdf" })]);
            },
          },
          "select multiple",
        ),
      ]);
  },
});

const MultiSelectStub = defineComponent({
  name: "MultiSelectStub",
  props: {
    modelValue: { type: Array, default: () => [] },
    options: { type: Array, default: () => [] },
    optionLabel: { type: String, default: "label" },
    optionValue: { type: String, default: "value" },
    placeholder: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  setup(props, { attrs }) {
    return () => {
      const values = new Set((props.modelValue as string[]).map((value) => String(value)));
      const selectedLabels = (props.options as Array<Record<string, unknown>>)
        .filter((option) => values.has(String(option[props.optionValue])))
        .map((option) => String(option[props.optionLabel] ?? ""));
      return h(
        "div",
        {
          ...attrs,
          "data-test": "variant-templates",
          "data-disabled": String(props.disabled),
        },
        selectedLabels.length > 0 ? selectedLabels.join(", ") : props.placeholder,
      );
    };
  },
});

const ElPaginationStub = defineComponent({
  name: "ElPaginationStub",
  props: {
    currentPage: { type: Number, required: true },
    pageSize: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  emits: ["current-change", "size-change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          type: "button",
          "data-test": "media-paginator",
          "data-first": String((props.currentPage - 1) * props.pageSize),
          "data-rows": String(props.pageSize),
          "data-total": String(props.total),
          onClick: () => emit("current-change", props.currentPage + 1),
        },
        "next",
      );
  },
});

const stubs = {
  Button: ButtonStub,
  Card: CardStub,
  Dialog: DialogStub,
  FailedVariantsDialog: true,
  ElPagination: ElPaginationStub,
  ElUpload: ElUploadStub,
  MediaSettingsDialog: true,
  Message: true,
  MultiSelect: MultiSelectStub,
  PageSectionHeader: PageSectionHeaderStub,
  Select: SelectStub,
  Tag: true,
};

/**
 * Mount the media list page with shared test plugins.
 * @returns Mounted wrapper
 */
const mountMediaListPage = () => {
  const authStore = useAuthStore();
  authStore.$patch({ accessToken: "token_abc" });
  return mount(MediaListPage, {
    global: {
      plugins: [
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

describe("MediaListPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerPushMock.mockReset();
    toastAddMock.mockReset();
    fetchFailedVariantsMock.mockResolvedValue([]);
    fetchMediaSettingsMock.mockResolvedValue({
      transformMode: "cloudflare",
      templates: [],
    });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restorePreviewObjectUrls();
  });

  it("loads the first page and renders a paginator from the API total", async () => {
    const fetchMock = mockMediaFetch();

    const wrapper = mountMediaListPage();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/media?limit=12&offset=0",
      expect.objectContaining({
        headers: { Authorization: "Bearer token_abc" },
      }),
    );
    const paginator = wrapper.find('[data-test="media-paginator"]');
    expect(paginator.exists()).toBe(true);
    expect(paginator.attributes("data-first")).toBe("0");
    expect(paginator.attributes("data-rows")).toBe("12");
    expect(paginator.attributes("data-total")).toBe("25");
  });

  it("requests the next server page when the paginator changes", async () => {
    const fetchMock = mockMediaFetch();

    const wrapper = mountMediaListPage();
    await flushPromises();
    await wrapper.find('[data-test="media-paginator"]').trigger("click");
    await flushPromises();

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls).toContain("/api/admin/media?limit=12&offset=12");
    expect(wrapper.find('[data-test="media-paginator"]').attributes("data-first")).toBe("12");
  });

  it("renders the media author and created timestamp on one row", async () => {
    mockMediaFetch();

    const wrapper = mountMediaListPage();
    await flushPromises();

    const timestamps = wrapper.get(".media-timestamps");
    expect(timestamps.findAll("div")).toHaveLength(0);
    expect(timestamps.text()).toMatch(/^nekobato, /);
    expect(timestamps.text()).toContain("2026");
  });

  it("resets to the first page when the type filter changes", async () => {
    const fetchMock = mockMediaFetch();

    const wrapper = mountMediaListPage();
    await flushPromises();
    await wrapper.find('[data-test="media-paginator"]').trigger("click");
    await flushPromises();
    await wrapper.find("#type").setValue("image");
    await flushPromises();

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls).toContain("/api/admin/media?type=image&limit=12&offset=0");
  });

  it("disables template selection when no variant templates exist", async () => {
    mockMediaFetch();
    mockPreviewObjectUrls();
    const wrapper = mountMediaListPage();
    await flushPromises();

    const uploadButton = wrapper.findAll("button").find((button) => button.text() === "ファイルアップロード");
    await uploadButton!.trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="select-image-file"]').trigger("click");
    await flushPromises();

    const templateSelect = wrapper.get('[data-test="variant-templates"]');
    expect(templateSelect.text()).toBe("テンプレートなし");
    expect(templateSelect.attributes("data-disabled")).toBe("true");
  });

  it("hides the default upload status badge for selected files", async () => {
    mockMediaFetch();
    mockPreviewObjectUrls();
    const wrapper = mountMediaListPage();
    await flushPromises();

    const uploadButton = wrapper.findAll("button").find((button) => button.text() === "ファイルアップロード");
    await uploadButton!.trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="select-image-file"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).not.toContain("Pending");
  });

  it("shows all templates as the initial value when variant templates exist", async () => {
    fetchMediaSettingsMock.mockResolvedValue({
      transformMode: "cloudflare",
      templates: [{ key: "thumbnail", label: "Thumbnail" }],
    });
    mockMediaFetch();
    mockPreviewObjectUrls();
    const wrapper = mountMediaListPage();
    await flushPromises();

    const uploadButton = wrapper.findAll("button").find((button) => button.text() === "ファイルアップロード");
    await uploadButton!.trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="select-image-file"]').trigger("click");
    await flushPromises();

    const templateSelect = wrapper.get('[data-test="variant-templates"]');
    expect(templateSelect.text()).toBe("全てのテンプレート");
    expect(templateSelect.attributes("data-disabled")).toBe("false");
  });

  it("uploads multiple selected files sequentially with one source file per request", async () => {
    const pendingPosts: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return new Promise<Response>((resolve) => pendingPosts.push(resolve));
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], total: 0, limit: 12, offset: 0 }),
      } as Response;
    });
    globalThis.fetch = fetchMock;

    const wrapper = mountMediaListPage();
    await flushPromises();
    const uploadButton = wrapper.findAll("button").find((button) => button.text() === "ファイルアップロード");
    await uploadButton!.trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="select-multiple-files"]').trigger("click");
    await flushPromises();
    const startButton = wrapper.findAll("button").find((button) => button.text() === "アップロードを開始");
    await startButton!.trigger("click");
    await flushPromises();

    const postCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls()).toHaveLength(1);
    const firstBody = postCalls()[0]?.[1]?.body as FormData;
    expect(firstBody.getAll("files[]")).toHaveLength(1);
    expect((firstBody.get("files[]") as File).name).toBe("first.pdf");

    pendingPosts.shift()?.(new Response("{}", { status: 201 }));
    await flushPromises();
    expect(postCalls()).toHaveLength(2);
    const secondBody = postCalls()[1]?.[1]?.body as FormData;
    expect(secondBody.getAll("files[]")).toHaveLength(1);
    expect((secondBody.get("files[]") as File).name).toBe("second.pdf");

    pendingPosts.shift()?.(new Response("{}", { status: 201 }));
    await flushPromises();
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: "success" }));
  });
});
