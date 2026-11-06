import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h, inject, provide, reactive, type PropType } from "vue";
import ModelEntriesPage from "../ModelEntriesPage.vue";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";

vi.mock("@/utils/http", () => ({
  authorizedFetch: vi.fn(),
}));

const pushMock = vi.fn();
const routeParams = reactive<{ modelId: string }>({ modelId: "model_posts" });

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: pushMock,
    resolve: (path: string) => ({ href: path }),
  }),
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: vi.fn() }),
  useConfirm: () => ({ require: vi.fn() }),
}));

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const titleField = {
  id: "field_title",
  name: "Title",
  fieldKey: "title",
  type: "text",
  required: true,
  hasLocales: false,
  isPrivate: false,
  isUnique: false,
  variant: "shortText",
  options: null,
  defaultValue: "",
  position: 0,
  isDisplayTitle: true,
};

const summaryField = {
  id: "field_summary",
  name: "Summary",
  fieldKey: "summary",
  type: "text",
  required: false,
  hasLocales: false,
  isPrivate: false,
  isUnique: false,
  variant: "longText",
  options: null,
  defaultValue: "",
  position: 1,
  isDisplayTitle: false,
};

type SheetResponseInput = {
  fields?: (typeof titleField)[];
  items?: Array<Record<string, unknown>>;
  model?: Record<string, unknown>;
};

const createEntry = (overrides: Record<string, unknown> = {}) => ({
  id: "entry_1",
  displayTitle: "Entry title",
  status: "draft",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  updatedBy: "user_1",
  updatedByName: "Admin",
  fields: [
    {
      fieldId: "field_title",
      locale: "en",
      type: "text",
      value: "Entry title",
    },
  ],
  ...overrides,
});

const sheetResponse = ({ fields = [titleField], items = [createEntry()], model = {} }: SheetResponseInput = {}) =>
  jsonResponse({
    model: {
      id: "model_posts",
      name: "Posts",
      description: null,
      fieldsCount: fields.length,
      entriesCount: items.length,
      titleFieldId: "field_title",
      fields,
      ...model,
    },
    locales: [{ code: "en", isDefault: true }],
    items,
  });

type ElTableStubContext = {
  getRows: () => Array<Record<string, unknown>>;
};

const ElTableStubKey = Symbol("ElTableStub");

const ButtonStub = defineComponent({
  name: "ButtonStub",
  props: {
    label: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
  },
  setup(props, { slots, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          disabled: props.disabled || props.loading,
        },
        slots.default?.() ?? props.label,
      );
  },
});

const ElTableStub = defineComponent({
  name: "ElTableStub",
  props: {
    data: {
      type: Array as PropType<Array<Record<string, unknown>>>,
      default: () => [],
    },
  },
  emits: ["selection-change"],
  setup(props, { emit, slots }) {
    provide<ElTableStubContext>(ElTableStubKey, {
      getRows: () => props.data,
    });

    return () =>
      h("div", { class: "data-table-stub" }, [
        slots.default?.(),
        h(
          "button",
          {
            type: "button",
            class: "select-first-entry",
            onClick: () => emit("selection-change", props.data.slice(0, 1)),
          },
          "select first",
        ),
      ]);
  },
});

const stubs = {
  PageSectionHeader: defineComponent({
    name: "PageSectionHeaderStub",
    props: {
      title: { type: String, default: "" },
    },
    setup(props, { slots }) {
      return () =>
        h("header", [h("h1", props.title), h("div", { class: "page-actions" }, slots.actions?.()), h("div", { class: "page-bottom" }, slots.bottom?.())]);
    },
  }),
  Button: ButtonStub,
  Card: defineComponent({
    name: "CardStub",
    setup(_props, { slots }) {
      return () => h("section", slots.content?.() ?? slots.default?.());
    },
  }),
  ElTable: ElTableStub,
  ElTableColumn: defineComponent({
    name: "ElTableColumnStub",
    props: {
      prop: { type: String, default: "" },
      label: { type: String, default: "" },
      width: { type: [Number, String], default: undefined },
      minWidth: { type: [Number, String], default: undefined },
    },
    setup(props, { slots }) {
      const table = inject<ElTableStubContext | null>(ElTableStubKey, null);
      return () =>
        h(
          "div",
          {
            class: "column-stub",
            "data-field": props.prop,
            "data-width": props.width,
            "data-min-width": props.minWidth,
          },
          [
            props.label ? h("span", { class: "column-header" }, props.label) : slots.header?.(),
            ...(table?.getRows() ?? []).map((row) =>
              h(
                "div",
                {
                  class: "column-cell",
                },
                slots.default?.({ row }) ?? (props.prop ? String(row[props.prop] ?? "") : ""),
              ),
            ),
          ],
        );
    },
  }),
  Select: defineComponent({
    name: "SelectStub",
    inheritAttrs: false,
    props: {
      modelValue: { type: [String, Number], default: "" },
      options: { type: Array as PropType<Array<{ label: string; value: string }>>, default: () => [] },
    },
    emits: ["update:modelValue"],
    setup(props, { attrs, emit }) {
      return () =>
        h(
          "select",
          {
            ...attrs,
            value: props.modelValue,
            onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
          },
          props.options.map((option) => h("option", { value: option.value }, option.label)),
        );
    },
  }),
  ElPagination: true,
  MultiSelect: defineComponent({
    name: "MultiSelectStub",
    props: {
      modelValue: {
        type: Array as PropType<string[]>,
        default: () => [],
      },
      options: {
        type: Array as PropType<Array<{ label: string; value: string }>>,
        default: () => [],
      },
    },
    emits: ["update:modelValue"],
    setup(props, { attrs, emit }) {
      return () =>
        h(
          "select",
          {
            ...attrs,
            multiple: true,
            value: props.modelValue,
            onChange: (event: Event) => {
              const selected = Array.from((event.target as HTMLSelectElement).selectedOptions).map((option) => option.value);
              emit("update:modelValue", selected);
            },
          },
          props.options.map((option) => h("option", { value: option.value }, option.label)),
        );
    },
  }),
  InputText: defineComponent({
    name: "InputTextStub",
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
  }),
  Tag: defineComponent({
    name: "TagStub",
    props: { value: { type: String, default: "" } },
    setup(props) {
      return () => h("span", props.value);
    },
  }),
  Dialog: defineComponent({
    name: "DialogStub",
    props: {
      visible: { type: Boolean, default: false },
      header: { type: String, default: "" },
    },
    setup(props, { slots }) {
      return () => (props.visible ? h("section", [props.header ? h("h2", props.header) : null, slots.default?.()]) : null);
    },
  }),
  Panel: defineComponent({
    name: "PanelStub",
    setup(_props, { slots }) {
      return () => h("section", slots.default?.());
    },
  }),
  ConfirmDialog: defineComponent({
    name: "ConfirmDialogStub",
    setup() {
      return () => null;
    },
  }),
};

describe("ModelEntriesPage", () => {
  const authorizedFetchMock = vi.mocked(authorizedFetch);

  beforeEach(() => {
    vi.restoreAllMocks();
    authorizedFetchMock.mockReset();
    pushMock.mockReset();
    setActivePinia(createPinia());
    const store = useAuthStore();
    store.$patch({ accessToken: "token_abc" });
  });

  it("reserves bulk action height while hiding controls until entries are selected", async () => {
    authorizedFetchMock.mockResolvedValueOnce(sheetResponse());

    const wrapper = mount(ModelEntriesPage, {
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

    const bulkActions = wrapper.get(".bulk-actions");
    expect(bulkActions.classes()).toContain("bulk-actions--hidden");
    expect(bulkActions.attributes("aria-hidden")).toBe("true");

    await wrapper.get(".select-first-entry").trigger("click");
    await flushPromises();

    expect(bulkActions.classes()).not.toContain("bulk-actions--hidden");
    expect(bulkActions.attributes("aria-hidden")).toBe("false");
  });

  it("uses the title field as the primary entries column", async () => {
    authorizedFetchMock.mockResolvedValueOnce(
      sheetResponse({
        fields: [{ ...titleField, name: "Author Name", fieldKey: "author_name" }],
        items: [createEntry({ displayTitle: "Ada Lovelace" })],
      }),
    );

    const wrapper = mount(ModelEntriesPage, {
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

    const titleColumn = wrapper.get('[data-field="field:field_title"]');
    expect(titleColumn.get(".column-header").text()).toBe("Author Name");
    expect(titleColumn.text()).toContain("Ada Lovelace");
    expect(titleColumn.text()).not.toContain("entry_1");
    expect(titleColumn.get(".entry-title-link").attributes("title")).toBe("Ada Lovelace");
  });

  it("opens the search dialog and fetches entries with the query", async () => {
    authorizedFetchMock
      .mockResolvedValueOnce(
        sheetResponse({
          fields: [{ ...titleField, name: "Author Name", fieldKey: "author_name" }],
          items: [
            createEntry({ displayTitle: "Ada Lovelace" }),
            createEntry({
              id: "entry_2",
              displayTitle: "Grace Hopper",
              fields: [
                {
                  fieldId: "field_title",
                  locale: "en",
                  type: "text",
                  value: "Grace Hopper",
                },
              ],
            }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        sheetResponse({
          fields: [{ ...titleField, name: "Author Name", fieldKey: "author_name" }],
          items: [createEntry({ displayTitle: "Ada Lovelace" })],
        }),
      );

    const wrapper = mount(ModelEntriesPage, {
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

    expect(wrapper.text()).toContain("Grace Hopper");

    await wrapper.get(".search-action-button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("エントリー検索");

    const searchInput = wrapper.get("#entry-search-query");
    expect(searchInput.attributes("name")).toBe("q");

    await searchInput.setValue("Ada");
    await wrapper.get(".search-dialog__form").trigger("submit");
    await flushPromises();

    const searchedPath = String(authorizedFetchMock.mock.calls[1]?.[1]);
    expect(searchedPath).toContain("/api/admin/models/model_posts/entries/sheet?");
    expect(searchedPath).toContain("mode=draft");
    expect(searchedPath).toContain("locale=en");
    expect(searchedPath).toContain("q=Ada");
    expect(wrapper.text()).toContain("Ada Lovelace");
    expect(wrapper.text()).not.toContain("Grace Hopper");
  });

  it("reflects selected model and system columns in the entries table", async () => {
    authorizedFetchMock.mockResolvedValueOnce(
      sheetResponse({
        fields: [titleField, summaryField],
        items: [
          createEntry({
            displayTitle: "Ada Lovelace",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                value: "Ada Lovelace",
              },
              {
                fieldId: "field_summary",
                locale: "en",
                type: "text",
                value: "Pioneer",
              },
            ],
          }),
        ],
      }),
    );

    const wrapper = mount(ModelEntriesPage, {
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

    expect(wrapper.find('[data-field="field:field_summary"]').exists()).toBe(false);
    expect(wrapper.find('[data-field="createdAt"]').exists()).toBe(true);

    await wrapper.get("#entry-visible-columns").setValue(["field:field_title", "field:field_summary", "status"]);
    await flushPromises();

    const summaryColumn = wrapper.get('[data-field="field:field_summary"]');
    expect(summaryColumn.get(".column-header").text()).toBe("Summary");
    expect(summaryColumn.text()).toContain("Pioneer");
    expect(summaryColumn.get(".entry-cell-text").attributes("title")).toBe("Pioneer");
    expect(wrapper.find('[data-field="createdAt"]').exists()).toBe(false);
    expect(wrapper.find('[data-field="status"]').exists()).toBe(true);
  });

  it("ignores legacy scheduled publication data in the status column", async () => {
    authorizedFetchMock.mockResolvedValueOnce(
      sheetResponse({
        items: [
          createEntry({
            status: "published",
            activeSchedules: [
              {
                id: "schedule_1",
                action: "unpublish",
                status: "pending",
                scheduledAt: "2026-06-20T10:30:00.000Z",
              },
            ],
          }),
        ],
      }),
    );

    const wrapper = mount(ModelEntriesPage, {
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

    const statusColumn = wrapper.get('[data-field="status"]');
    expect(statusColumn.text()).toContain("公開済み");
    expect(statusColumn.text()).not.toContain("非公開予約");
    expect(statusColumn.text()).not.toContain("待機中");
    expect(statusColumn.find(".entry-status-schedule").exists()).toBe(false);
  });
});
