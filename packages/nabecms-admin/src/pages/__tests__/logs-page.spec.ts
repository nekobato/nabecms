import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h, inject, provide, toRef } from "vue";
import type { PropType, Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import LogsPage from "../LogsPage.vue";

vi.mock("@/utils/http", () => ({
  authorizedFetch: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const tableRowsKey = "table-rows";

const PageSectionHeaderStub = defineComponent({
  name: "PageSectionHeaderStub",
  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
  },
  setup(props) {
    return () => h("header", [h("h1", props.title), props.description ? h("p", props.description) : null]);
  },
});

const ElTableStub = defineComponent({
  name: "ElTableStub",
  props: {
    data: { type: Array as PropType<unknown[]>, default: () => [] },
  },
  setup(props, { attrs, slots }) {
    provide(tableRowsKey, toRef(props, "data"));
    return () =>
      h(
        "section",
        {
          "data-stub": "ElTable",
          "data-table-style": typeof attrs.style === "string" ? attrs.style : JSON.stringify(attrs.style),
        },
        slots.default?.(),
      );
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumnStub",
  props: {
    prop: { type: String, default: "" },
    label: { type: String, default: "" },
  },
  setup(props, { slots }) {
    const rows = inject<Ref<unknown[]>>(tableRowsKey);
    return () =>
      h("div", { "data-column": props.label || props.prop }, [
        h("strong", props.label),
        ...(rows?.value ?? []).map((row) => {
          const rowRecord = row as Record<string, unknown>;
          return h("div", slots.default?.({ row }) ?? String(rowRecord[props.prop] ?? ""));
        }),
      ]);
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  setup(_props, { attrs, slots }) {
    return () => h("button", attrs, slots.default?.() ?? (typeof attrs.label === "string" ? attrs.label : ""));
  },
});

const NabeIconStub = defineComponent({
  name: "NabeIconStub",
  setup() {
    return () => h("span", { "aria-hidden": "true" });
  },
});

const DatePickerStub = defineComponent({
  name: "ElDatePicker",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", { ...attrs, type: "date", value: props.modelValue, onInput: (e: Event) => emit("update:modelValue", (e.target as HTMLInputElement).value) });
  },
});
const SelectStub = defineComponent({
  name: "ElSelect",
  props: ["modelValue"],
  emits: ["update:modelValue"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        "select",
        { ...attrs, value: props.modelValue, onChange: (e: Event) => emit("update:modelValue", (e.target as HTMLSelectElement).value) },
        slots.default?.(),
      );
  },
});
const OptionStub = defineComponent({
  props: ["value", "label"],
  setup(props) {
    return () => h("option", { value: props.value }, props.label);
  },
});
const PaginationStub = defineComponent({
  name: "ElPagination",
  props: ["currentPage", "pageSize", "total"],
  emits: ["current-change", "size-change"],
  setup(props, { emit }) {
    return () =>
      h("nav", { "data-page": props.currentPage, "data-total": props.total }, [
        h("button", { "data-next": "", onClick: () => emit("current-change", 2) }, "Next"),
        h("button", { "data-size": "", onClick: () => emit("size-change", 50) }, "50"),
      ]);
  },
});

const stubs = {
  Button: ButtonStub,
  ElTable: ElTableStub,
  ElTableColumn: ElTableColumnStub,
  NabeIcon: NabeIconStub,
  PageSectionHeader: PageSectionHeaderStub,
  ElDatePicker: DatePickerStub,
  ElSelect: SelectStub,
  ElOption: OptionStub,
  ElPagination: PaginationStub,
};

const authorizedFetchMock = vi.mocked(authorizedFetch);

const jsonResponse = (body: unknown) =>
  ({
    json: async () => body,
    ok: true,
    status: 200,
  }) as Response;

beforeEach(() => {
  vi.resetAllMocks();
});
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
});

const mountPage = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({ accessToken: "token_abc" });

  const wrapper = mount(LogsPage, {
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
      directives: { loading: () => undefined },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

describe("LogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorizedFetchMock.mockResolvedValue(
      jsonResponse({
        auditLogs: {
          items: [
            {
              id: "audit_1",
              userId: "user_1",
              userName: "nekobato",
              userEmail: "nekobato@gmail.com",
              action: "update",
              targetTable: "entries",
              targetId: "entry_1",
              before: {},
              after: {},
              createdAt: "2026-06-09T16:11:29.000Z",
            },
          ],
          total: 1,
        },
        entryRevisions: {
          items: [
            {
              id: "revision_1",
              entryId: "entry_1",
              revisionNumber: 1,
              status: "draft",
              createdBy: "nekobato@gmail.com",
              createdByName: "nekobato",
              createdAt: "2026-06-09T16:11:29.000Z",
              publishedAt: null,
              modelId: "model_1",
              modelName: "Blog",
              entryStatus: "draft",
              content: { privateBody: "revision-body-secret" },
            },
          ],
          total: 1,
        },
      }),
    );
  });

  it("does not render email addresses in log user cells", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("nekobato");
    expect(wrapper.text()).not.toContain("nekobato@gmail.com");
    expect(wrapper.text()).not.toContain("revision-body-secret");
  });
});

const fixture = (id = "audit-latest", total = 45) => ({
  auditLogs: {
    items: [
      {
        id,
        action: "publish",
        targetTable: "entries",
        targetId: id,
        userName: null,
        userId: null,
        before: { status: "draft", password: "never-render" },
        after: { status: "published", publishedRevisionId: "rev-2" },
        createdAt: "2026-09-15 10:00:00",
      },
    ],
    total,
  },
  entryRevisions: {
    items: [
      {
        id: "revision-1",
        entryId: "deleted-entry",
        revisionNumber: 1,
        status: "draft",
        modelId: null,
        modelName: null,
        createdByName: null,
        createdAt: "2026-09-15T10:00:00Z",
      },
    ],
    total: 1,
  },
  authLogs: {
    items: [
      { id: "auth-1", userId: null, userName: null, result: "failed", reason: "user_not_found", createdAt: "2026-09-15 10:00:00" },
      { id: "auth-2", userId: "user-2", userName: "Reader", result: "success", reason: null, createdAt: "2026-09-15T10:00:00Z" },
    ],
    total,
  },
});
const queryOfLastRequest = () => new URL(String(authorizedFetchMock.mock.calls.at(-1)?.[1]), "https://test.example").searchParams;

it("applies audit search to all pages, resets pagination, and keeps unsubmitted inputs separate", async () => {
  authorizedFetchMock.mockResolvedValue(jsonResponse(fixture()));
  const wrapper = mountPage();
  await flushPromises();
  await wrapper.get("[data-next]").trigger("click");
  await flushPromises();
  expect(queryOfLastRequest().get("auditOffset")).toBe("20");
  await wrapper.get("#audit-id").setValue("  entry-204  ");
  await wrapper.get("#audit-value").setValue("publish");
  await wrapper.get("#audit-from").setValue("2026-09-08");
  await wrapper.get("#audit-to").setValue("2026-09-15");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(Object.fromEntries(queryOfLastRequest())).toMatchObject({
    action: "publish",
    targetId: "entry-204",
    auditOffset: "0",
    dateFrom: new Date("2026-09-08T00:00:00").toISOString(),
    dateTo: new Date("2026-09-15T23:59:59.999").toISOString(),
  });
  await wrapper.get("#audit-id").setValue("not-applied");
  await wrapper.get("[data-next]").trigger("click");
  await flushPromises();
  expect(queryOfLastRequest().get("targetId")).toBe("entry-204");
  expect(queryOfLastRequest().get("auditOffset")).toBe("20");
  await wrapper.get("[data-size]").trigger("click");
  await flushPromises();
  expect(Object.fromEntries(queryOfLastRequest())).toMatchObject({ auditLimit: "50", auditOffset: "0", targetId: "entry-204" });
  await wrapper
    .get("form")
    .findAll("button")
    .find((button) => button.text() === "クリア")!
    .trigger("click");
  await flushPromises();
  expect(queryOfLastRequest().has("targetId")).toBe(false);
  expect(queryOfLastRequest().has("dateFrom")).toBe(false);
});

it("loads authentication on demand, preserves tab state, and renders unknown users and safe metadata", async () => {
  authorizedFetchMock.mockResolvedValue(jsonResponse(fixture()));
  const wrapper = mountPage();
  await flushPromises();
  expect(authorizedFetchMock).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("公開済み");
  expect(wrapper.text()).not.toContain("never-render");
  await wrapper.get("#audit-id").setValue("draft-input");
  await wrapper.get("#tab-auth").trigger("click");
  await flushPromises();
  expect(String(authorizedFetchMock.mock.calls.at(-1)?.[1])).toContain("/logs/auth?");
  expect(wrapper.text()).toContain("利用者が見つかりません");
  expect(wrapper.text()).toContain("利用者情報なし");
  expect(wrapper.text()).toContain("成功");
  expect(wrapper.text()).toContain("失敗");
  await wrapper.get("#auth-value").setValue("failed");
  await wrapper.get("#auth-id").setValue("user-2");
  await wrapper
    .get("#auth-id")
    .element.closest("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flushPromises();
  expect(Object.fromEntries(queryOfLastRequest())).toMatchObject({ result: "failed", userId: "user-2", offset: "0" });
  await wrapper.get("#tab-audit").trigger("click");
  await flushPromises();
  expect((wrapper.get("#audit-id").element as HTMLInputElement).value).toBe("draft-input");
  await wrapper.get("#tab-revisions").trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("deleted-entry");
  expect(wrapper.findAll("button").some((button) => button.text() === "エントリーを開く")).toBe(false);
});

it("rejects reversed date ranges without changing the applied search", async () => {
  authorizedFetchMock.mockResolvedValue(jsonResponse(fixture()));
  const wrapper = mountPage();
  await flushPromises();
  await wrapper.get("#audit-from").setValue("2026-09-16");
  await wrapper.get("#audit-to").setValue("2026-09-15");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(authorizedFetchMock).toHaveBeenCalledTimes(1);
  expect(wrapper.get("[role=alert]").text()).toContain("開始日は終了日以前");
});

it("distinguishes permission errors and network failures, retries, and ignores stale responses", async () => {
  let resolveOld!: (value: Response) => void;
  authorizedFetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const wrapper = mountPage();
  await flushPromises();
  expect(wrapper.text()).toContain("読み込み中");
  authorizedFetchMock.mockResolvedValueOnce(jsonResponse(fixture("new-result")));
  await wrapper.get("#audit-id").setValue("new-result");
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  resolveOld(jsonResponse(fixture("old-result")));
  await flushPromises();
  expect(wrapper.text()).toContain("new-result");
  expect(wrapper.text()).not.toContain("old-result");
  authorizedFetchMock.mockResolvedValueOnce({ ok: false, status: 403 } as Response);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain("権限がありません");
  expect(wrapper.text()).not.toContain("new-result");
  authorizedFetchMock.mockRejectedValueOnce(new Error("network"));
  await wrapper.get("[role=alert] button").trigger("click");
  await flushPromises();
  expect(wrapper.get("[role=alert]").text()).toContain("取得できませんでした");
  authorizedFetchMock.mockResolvedValueOnce(jsonResponse({ ...fixture(), auditLogs: { total: 0, items: [] } }));
  await wrapper.get("[role=alert] button").trigger("click");
  await flushPromises();
  expect(wrapper.find("[role=alert]").exists()).toBe(false);
  expect(wrapper.get("[data-total]").attributes("data-total")).toBe("0");
  expect(queryOfLastRequest().get("targetId")).toBe("new-result");
});
