import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, inject, provide, ref, toRef, type PropType, type Ref } from "vue";

import RelationFieldEditor from "../RelationFieldEditor.vue";

type RelationValue = {
  type: "one" | "many";
  entryIds: string[];
};

type EntryOption = {
  id: string;
  modelId: string;
  displayTitle: string;
  status: string;
  updatedAt: string | null;
};

type LocaleOption = {
  code: string;
  isDefault?: boolean;
};

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  emits: ["click"],
  setup(props, { emit, slots, attrs }) {
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

const SelectStub = defineComponent({
  name: "SelectStub",
  inheritAttrs: false,
  props: {
    modelValue: { type: [String, Object, Number, Boolean], default: undefined },
    options: { type: Array, default: () => [] },
    optionLabel: { type: String, default: "label" },
    optionValue: { type: String, default: "value" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs, slots }) {
    return () =>
      h("div", { ...attrs, "data-stub": "Select" }, [
        ...(props.options as Record<string, unknown>[]).map((option) =>
          h(
            "button",
            {
              type: "button",
              "data-option-id": option[props.optionValue] as string,
              onClick: () => emit("update:modelValue", option[props.optionValue]),
            },
            option[props.optionLabel] as string,
          ),
        ),
        slots.footer?.(),
      ]);
  },
});

const InputTextStub = defineComponent({
  name: "InputTextStub",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h("input", {
        ...attrs,
        "data-stub": "InputText",
        value: props.modelValue,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});
const tableRowsKey = Symbol("tableRows");

const ElTableStub = defineComponent({
  name: "ElTableStub",
  inheritAttrs: false,
  props: {
    data: { type: Array as PropType<EntryOption[]>, default: () => [] },
  },
  setup(props, { slots, attrs }) {
    provide(tableRowsKey, toRef(props, "data"));
    return () => h("div", { ...attrs, "data-stub": "ElTable" }, [slots.default?.(), props.data.length === 0 ? slots.empty?.() : null]);
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumnStub",
  props: {
    prop: { type: String, default: undefined },
    minWidth: { type: Number, default: undefined },
  },
  setup(_, { slots }) {
    const rows = inject<Ref<EntryOption[]>>(tableRowsKey);
    return () =>
      h(
        "div",
        (rows?.value ?? []).map((row) => slots.default?.({ row })),
      );
  },
});

const RadioButtonStub = defineComponent({
  name: "RadioButtonStub",
  inheritAttrs: false,
  props: { value: { type: String, required: true } },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () => h("button", { ...attrs, type: "button", onClick: () => emit("update:modelValue", props.value) }, props.value);
  },
});

const CheckboxStub = defineComponent({
  name: "CheckboxStub",
  inheritAttrs: false,
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () => h("button", { ...attrs, type: "button", onClick: () => emit("update:modelValue", !props.modelValue) }, String(props.modelValue));
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

const RelationEntryCreateDialogStub = defineComponent({
  name: "RelationEntryCreateDialog",
  inheritAttrs: false,
  props: {
    visible: { type: Boolean, default: false },
    modelId: { type: String, default: null },
    modelName: { type: String, default: null },
    locales: { type: Array as PropType<LocaleOption[]>, default: () => [] },
    defaultLocale: { type: String, default: "en" },
    localeFilter: { type: String, default: "all" },
  },
  emits: ["created", "update:visible"],
  setup(props, { emit }) {
    return () =>
      props.visible
        ? h(
            "div",
            {
              "data-test": "relation-create-dialog",
              "data-model-id": props.modelId ?? "",
              "data-model-name": props.modelName ?? "",
              "data-default-locale": props.defaultLocale,
              "data-locale-filter": props.localeFilter,
              "data-locales": props.locales.map((item) => `${item.code}:${Boolean(item.isDefault)}`).join(","),
            },
            [
              h(
                "button",
                {
                  type: "button",
                  "data-test": "relation-create-emit",
                  onClick: () =>
                    emit("created", {
                      id: "entry-new",
                      modelId: props.modelId ?? "article",
                      status: "draft",
                      updatedAt: null,
                    }),
                },
                "created",
              ),
            ],
          )
        : null;
  },
});

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key;
      return `${key}`;
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

const loadEntryReferenceMock = vi.fn();
const getCachedEntryReferenceMock = vi.fn();
vi.mock("@/services/entryReferences", () => ({
  loadEntryReference: (...args: unknown[]) => loadEntryReferenceMock(...args),
  getCachedEntryReference: (...args: unknown[]) => getCachedEntryReferenceMock(...args),
}));

const createResponse = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return data;
  },
  async text() {
    return typeof data === "string" ? data : JSON.stringify(data);
  },
});

const stubs = {
  Button: ButtonStub,
  Select: SelectStub,
  InputText: InputTextStub,
  Checkbox: CheckboxStub,
  Dialog: DialogStub,
  ElTable: ElTableStub,
  ElTableColumn: ElTableColumnStub,
  RadioButton: RadioButtonStub,
  RelationEntryCreateDialog: RelationEntryCreateDialogStub,
};

type MountOptions = {
  variant: "one" | "many";
  modelValue: RelationValue | null;
  allowedModelIds: string[];
  locales?: LocaleOption[];
  defaultLocale?: string;
  localeFilter?: string;
};

const mountWithHost = ({ variant, modelValue, allowedModelIds, locales, defaultLocale, localeFilter }: MountOptions) => {
  const updates: Array<RelationValue | null> = [];
  const Host = defineComponent({
    name: "RelationHost",
    components: { RelationFieldEditor },
    setup() {
      const value = ref<RelationValue | null>(modelValue);
      const handleUpdate = (next: RelationValue | null) => {
        updates.push(next);
        value.value = next;
      };
      return () =>
        h(RelationFieldEditor, {
          modelValue: value.value,
          variant,
          allowedModelIds,
          locales,
          defaultLocale,
          localeFilter,
          "onUpdate:modelValue": handleUpdate,
        });
    },
  });
  const wrapper = mount(Host, {
    global: { stubs },
  });
  return { wrapper, updates };
};

describe("RelationFieldEditor", () => {
  beforeEach(() => {
    authorizedFetchMock.mockReset();
    loadEntryReferenceMock.mockReset();
    getCachedEntryReferenceMock.mockReset();

    getCachedEntryReferenceMock.mockImplementation(() => undefined);
    loadEntryReferenceMock.mockImplementation(async (entryId: string) => ({
      entryId,
      modelId: "article",
      modelName: "Article",
      displayTitle: `Entry ${entryId}`,
    }));
  });

  afterEach(() => {
    window.localStorage.removeItem("locale");
  });

  it("emits selected entry for single relation variant", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([{ id: "entry-1", modelId: "article", displayTitle: "First", status: "published", updatedAt: null }]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper, updates } = mountWithHost({ variant: "one", modelValue: null, allowedModelIds: ["article"] });

    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    expect(editor.exists()).toBe(true);

    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    const table = editor.findComponent(ElTableStub);
    expect(table.exists()).toBe(true);
    await table.find('[data-row-id="entry-1"]').trigger("click");

    await editor.find('[data-test="relation-apply"]').trigger("click");

    expect(updates.pop()).toEqual({ type: "one", entryIds: ["entry-1"] });
  });

  it("merges selections for many relation variant without duplicates", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([
          { id: "entry-1", modelId: "article", displayTitle: "Entry One", status: "draft", updatedAt: null },
          { id: "entry-2", modelId: "article", displayTitle: "Entry Two", status: "published", updatedAt: null },
        ]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper, updates } = mountWithHost({
      variant: "many",
      modelValue: { type: "many", entryIds: ["entry-1"] },
      allowedModelIds: ["article"],
    });

    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    const table = editor.findComponent(ElTableStub);
    expect(table.exists()).toBe(true);

    await table.find('[data-row-id="entry-2"]').trigger("click");
    await editor.find('[data-test="relation-apply"]').trigger("click");

    const latest = updates.pop();
    expect(latest).toEqual({ type: "many", entryIds: ["entry-1", "entry-2"] });

    const removeButtons = editor.findAll('[data-test="relation-remove"]');
    expect(removeButtons.length).toBeGreaterThan(0);
    await removeButtons[0].trigger("click");

    const afterRemoval = updates.pop();
    expect(afterRemoval).toEqual({ type: "many", entryIds: ["entry-2"] });
  });

  it("renders relation timestamps on separate date and time lines", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([{ id: "entry-1", modelId: "article", displayTitle: "Entry One", status: "draft", updatedAt: "2026/05/21 17:39:34" }]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    window.localStorage.setItem("locale", "ja-JP");
    const { wrapper } = mountWithHost({ variant: "many", modelValue: { type: "many", entryIds: [] }, allowedModelIds: ["article"] });
    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    expect(
      editor
        .get(".dialog-date-time")
        .findAll(".dialog-date-time__line")
        .map((line) => line.text()),
    ).toEqual(["2026/05/21", "17:39:34"]);
  });

  it("does not render the bulk clear selection action", async () => {
    const { wrapper } = mountWithHost({
      variant: "many",
      modelValue: { type: "many", entryIds: ["entry-1"] },
      allowedModelIds: ["article"],
    });

    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    expect(editor.find('[data-test="relation-clear"]').exists()).toBe(false);
  });

  it("preserves order and supports manual reordering for many variant", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([
          { id: "entry-1", modelId: "article", displayTitle: "Entry One", status: "draft", updatedAt: null },
          { id: "entry-2", modelId: "article", displayTitle: "Entry Two", status: "published", updatedAt: null },
          { id: "entry-3", modelId: "article", displayTitle: "Entry Three", status: "published", updatedAt: null },
        ]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper, updates } = mountWithHost({
      variant: "many",
      modelValue: { type: "many", entryIds: ["entry-1", "entry-2", "entry-3"] },
      allowedModelIds: ["article"],
    });

    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    const chips = editor.findAll(".relation-chip");
    expect(chips).toHaveLength(3);

    // move middle down -> order: 1,3,2
    await chips[1].find('[data-test="relation-move-down"]').trigger("click");
    expect(updates.pop()).toEqual({ type: "many", entryIds: ["entry-1", "entry-3", "entry-2"] });

    // move last up -> order: 1,2,3
    const refreshedChips = editor.findAll(".relation-chip");
    await refreshedChips[2].find('[data-test="relation-move-up"]').trigger("click");
    expect(updates.pop()).toEqual({ type: "many", entryIds: ["entry-1", "entry-2", "entry-3"] });
  });

  it("places reorder controls before labels and remove control after labels", async () => {
    const { wrapper } = mountWithHost({
      variant: "many",
      modelValue: { type: "many", entryIds: ["entry-1"] },
      allowedModelIds: ["article"],
    });

    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    const chip = editor.get(".relation-chip");
    const children = Array.from(chip.element.children);

    expect(children[0]?.classList.contains("relation-chip__reorder")).toBe(true);
    expect(children[1]?.classList.contains("relation-chip__labels")).toBe(true);
    expect(children.at(-1)?.classList.contains("relation-chip__remove")).toBe(true);
    expect(chip.findAll(".relation-chip__reorder button").map((button) => button.attributes("data-test"))).toEqual(["relation-move-up", "relation-move-down"]);
  });

  it("does not render the related entry creation action in the model selector", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper } = mountWithHost({ variant: "one", modelValue: null, allowedModelIds: ["article"] });
    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    expect(editor.find('[data-test="relation-create-open"]').exists()).toBe(false);
  });

  it("opens related entry creation from the empty results state", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper } = mountWithHost({ variant: "one", modelValue: null, allowedModelIds: ["article"] });
    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    await editor.find('[data-test="relation-empty-create-open"]').trigger("click");
    await flushPromises();

    const createDialog = editor.get('[data-test="relation-create-dialog"]');
    expect(createDialog.attributes("data-model-id")).toBe("article");
    expect(createDialog.attributes("data-model-name")).toBe("Article");
  });

  it("passes the current locale context to related entry creation", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper } = mountWithHost({
      variant: "one",
      modelValue: null,
      allowedModelIds: ["article"],
      locales: [{ code: "ja", isDefault: true }],
      defaultLocale: "ja",
      localeFilter: "ja",
    });
    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    await editor.find('[data-test="relation-empty-create-open"]').trigger("click");
    await flushPromises();

    const createDialog = editor.get('[data-test="relation-create-dialog"]');
    expect(createDialog.attributes("data-default-locale")).toBe("ja");
    expect(createDialog.attributes("data-locale-filter")).toBe("ja");
    expect(createDialog.attributes("data-locales")).toBe("ja:true");
  });

  it("selects a newly created related entry before confirmation", async () => {
    authorizedFetchMock.mockImplementation(async (_auth, input: unknown) => {
      if (input === "/api/admin/models") {
        return createResponse({ items: [{ id: "article", name: "Article" }] });
      }
      if (typeof input === "string" && input.startsWith("/api/admin/models/article/entries")) {
        return createResponse([]);
      }
      throw new Error(`Unhandled fetch: ${input}`);
    });

    const { wrapper, updates } = mountWithHost({ variant: "one", modelValue: null, allowedModelIds: ["article"] });
    await flushPromises();

    const editor = wrapper.findComponent(RelationFieldEditor);
    await editor.find('[data-test="relation-open"]').trigger("click");
    await flushPromises();

    await editor.find('[data-test="relation-empty-create-open"]').trigger("click");
    await editor.find('[data-test="relation-create-emit"]').trigger("click");
    await flushPromises();

    expect(loadEntryReferenceMock).toHaveBeenCalledWith("entry-new");

    await editor.find('[data-test="relation-apply"]').trigger("click");

    expect(updates.pop()).toEqual({ type: "one", entryIds: ["entry-new"] });
  });
});
