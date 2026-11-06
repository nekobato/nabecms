import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h, reactive } from "vue";
import ja from "@/locales/ja.json";
import ModelsListPage from "../ModelsListPage.vue";
import ModelCreatePage from "../ModelCreatePage.vue";
import ModelDetailPage from "../ModelDetailPage.vue";
import ContentsListPage from "@/pages/contents/ContentsListPage.vue";
import { useAuthStore } from "@/stores/auth";
import { defineRule } from "vee-validate";
import { required, min } from "@vee-validate/rules";

type FetchSequenceItem = { ok: boolean; status: number; body: unknown };
type CreateSubmitPayload = { name: string; description?: string | null; isPublic: boolean };

defineRule("required", required);
defineRule("min", min);

const pushMock = vi.fn();
const backMock = vi.fn();
const routeParams = reactive<{ modelId: string }>({ modelId: "model_1" });
const toastAddMock = vi.fn();

const originalFetch = globalThis.fetch;

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

const InputTextStub = defineComponent({
  name: "InputTextStub",
  props: { modelValue: { type: [String, Number], default: "" } },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => {
          const target = event.target as HTMLInputElement;
          emit("update:modelValue", target.value);
          const handler = attrs.onInput as ((event: Event) => void) | undefined;
          handler?.(event);
        },
      });
  },
});

const TextareaStub = defineComponent({
  name: "TextareaStub",
  props: { modelValue: { type: String, default: "" } },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h("textarea", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => {
          const target = event.target as HTMLTextAreaElement;
          emit("update:modelValue", target.value);
          const handler = attrs.onInput as ((event: Event) => void) | undefined;
          handler?.(event);
        },
      });
  },
});

const CheckboxStub = defineComponent({
  name: "CheckboxStub",
  props: { modelValue: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h("input", {
        type: "checkbox",
        ...attrs,
        checked: props.modelValue,
        onChange: (event: Event) => {
          const target = event.target as HTMLInputElement;
          emit("update:modelValue", target.checked);
          const handler = attrs.onChange as ((event: Event) => void) | undefined;
          handler?.(event);
        },
      });
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  setup(_props, { slots, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: (attrs.type as string) ?? "button",
          onClick: (event: Event) => {
            const handler = attrs.onClick as ((event: Event) => void) | undefined;
            handler?.(event);
          },
        },
        slots.default ? slots.default() : (attrs.label ?? ""),
      );
  },
});

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("div", slots.content ? slots.content() : slots.default?.());
  },
});

const DataViewStub = defineComponent({
  name: "DataViewStub",
  inheritAttrs: false,
  props: {
    value: { type: Array, default: () => [] },
    layout: { type: String, default: "list" },
    dataKey: { type: String, default: "id" },
  },
  setup(_props, { slots }) {
    return () => slots.list?.() ?? null;
  },
});

const TagStub = defineComponent({
  name: "TagStub",
  props: { value: { type: String, default: "" } },
  setup(props) {
    return () => h("span", props.value);
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  inheritAttrs: false,
  props: {
    visible: { type: Boolean, default: false },
  },
  setup(props, { attrs, slots }) {
    return () =>
      props.visible
        ? h(
            "section",
            {
              ...attrs,
              class: ["dialog-stub", attrs.class],
            },
            [slots.header?.(), slots.default?.(), slots.footer?.()],
          )
        : null;
  },
});

const RouterLinkStub = defineComponent({
  name: "RouterLinkStub",
  props: {
    to: { type: [String, Object], required: true },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        "a",
        {
          ...attrs,
          href: typeof props.to === "string" ? props.to : "#",
          onClick: (event: Event) => {
            const handler = attrs.onClick as ((event: Event) => void) | undefined;
            handler?.(event);
            if (typeof props.to === "string") {
              pushMock(props.to);
            }
          },
        },
        slots.default?.(),
      );
  },
});

const stubs = {
  Button: ButtonStub,
  Card: CardStub,
  Dialog: DialogStub,
  DataView: DataViewStub,
  InputText: InputTextStub,
  Textarea: TextareaStub,
  Checkbox: CheckboxStub,
  Tag: TagStub,
  RouterLink: RouterLinkStub,
  ModelFieldsTable: defineComponent({
    name: "ModelFieldsTableStub",
    props: {
      fields: { type: Array, default: () => [] },
      titleFieldId: { type: String, default: null },
      editingInline: { type: Boolean, default: false },
      deletingFieldIds: { type: Object, default: () => ({}) },
    },
    emits: ["edit-field", "delete-field", "add-field", "row-reorder", "apply-order", "reset-order", "select-title"],
    setup(props, { emit }) {
      return () =>
        h("div", { class: "fields-stub" }, [
          h(
            "div",
            { class: "fields-stub-list" },
            (props.fields as unknown[]).map((field) => {
              const typedField = field as { id: string; name: string };
              return h("div", { class: "field-row" }, [
                h("span", typedField.name),
                h(
                  "button",
                  {
                    class: "edit-field-button",
                    onClick: () => emit("edit-field", typedField.id),
                  },
                  "edit",
                ),
                h(
                  "button",
                  {
                    class: "delete-field-button",
                    disabled: (props.deletingFieldIds as Record<string, boolean>)[typedField.id] === true,
                    onClick: () => emit("delete-field", typedField.id),
                  },
                  "delete",
                ),
              ]);
            }),
          ),
        ]);
    },
  }),
  ModelEditForm: defineComponent({
    name: "ModelEditFormStub",
    props: {
      model: { type: Object, default: () => ({}) },
      showPublicField: { type: Boolean, default: true },
      submitting: { type: Boolean, default: false },
    },
    emits: ["submit", "dirty-change", "valid-change"],
    setup(props, { emit, expose }) {
      emit("dirty-change", false);
      emit("valid-change", true);
      const submitForm = () => {
        emit("submit", {
          name: "Updated",
          description: "Updated description",
          isPublic: (props.model as { isPublic?: boolean }).isPublic ?? true,
        });
      };
      expose({ submitForm });
      return () => h("div", { class: "model-edit-form-stub", "data-show-public": String(props.showPublicField) }, "model form");
    },
  }),
  ModelFieldCreateDialog: defineComponent({
    name: "ModelFieldCreateDialogStub",
    props: {
      visible: { type: Boolean, default: false },
    },
    emits: ["submit", "update:visible"],
    setup(_props, { emit, slots }) {
      return () =>
        h(
          "div",
          {
            class: "model-field-add-dialog-stub",
            onClick: () => emit("update:visible", false),
          },
          slots.default?.(),
        );
    },
  }),
  ModelFieldEditDialog: defineComponent({
    name: "ModelFieldEditDialogStub",
    props: {
      visible: { type: Boolean, default: false },
      field: { type: Object, default: null },
    },
    emits: ["update:visible", "update-field"],
    setup(_props, { emit, slots }) {
      return () =>
        h(
          "div",
          {
            class: "model-field-edit-dialog-stub",
            onClick: () => emit("update:visible", false),
          },
          slots.default?.(),
        );
    },
  }),
  Select: defineComponent({
    name: "SelectStub",
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
  Toast: defineComponent({
    name: "ToastStub",
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
};

function mockFetch(sequence: FetchSequenceItem[]) {
  const impl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
    if (sequence.length === 0) {
      throw new Error("Unexpected fetch call");
    }
    const { ok, status, body } = sequence.shift()!;
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Headers(),
    } as Response;
  });
  globalThis.fetch = impl as unknown as typeof fetch;
  return impl;
}

describe("Models and contents pages integration", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.accessToken = "token";
    auth.refresh = vi.fn().mockResolvedValue(true);
    pushMock.mockReset();
    backMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    toastAddMock.mockReset();
  });

  const i18n = createI18n({ legacy: false, locale: "ja", messages: { ja } });

  const mountOptions = {
    global: {
      plugins: [i18n],
      stubs,
    },
  } as const;

  it("renders model rows as links and navigates to detail when activated", async () => {
    mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          items: [
            {
              id: "model_1",
              name: "Articles",
              description: "Blog posts",
              isPublic: true,
              createdAt: "2025-09-23T00:00:00.000Z",
              updatedAt: "2025-09-24T00:00:00.000Z",
              updatedBy: "admin-user",
              fieldsCount: 2,
            },
          ],
        },
      },
    ]);

    const wrapper = mount(ModelsListPage, mountOptions);
    await flushPromises();

    const rows = wrapper.findAll(".row.item");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("Articles");
    expect(rows[0].text()).not.toContain("admin-user");
    expect(wrapper.find(".col-updated-by").exists()).toBe(false);
    expect(wrapper.find(".col-updated").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("最終更新者");
    expect(rows[0].attributes("href")).toBe("/models/model_1");

    await rows[0].trigger("click");
    expect(pushMock).toHaveBeenCalledWith("/models/model_1");
  });

  it("renders content rows as links and navigates to entries when activated", async () => {
    mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          items: [
            {
              id: "model_posts",
              name: "Posts",
              description: "Published articles",
              entriesCount: 12,
            },
            {
              id: "model_pages",
              name: "Pages",
              description: "Landing pages",
              entriesCount: 3,
            },
          ],
        },
      },
    ]);

    const wrapper = mount(ContentsListPage, mountOptions);
    await flushPromises();

    const rows = wrapper.findAll(".row.item");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Posts");
    expect(rows[0].attributes("href")).toBe("/contents/model_posts");
    expect(rows[1].text()).toContain("Pages");
    expect(rows[1].attributes("href")).toBe("/contents/model_pages");

    await rows[0].trigger("click");
    expect(pushMock).toHaveBeenCalledWith("/contents/model_posts");
  });

  it("submits create form and redirects to detail page", async () => {
    mockFetch([
      {
        ok: true,
        status: 201,
        body: {
          item: {
            id: "model_new",
            name: "Docs",
            description: "All docs",
            isPublic: false,
            createdAt: "2025-09-24T12:00:00.000Z",
            updatedAt: "2025-09-24T12:00:00.000Z",
            fieldsCount: 0,
          },
        },
      },
    ]);

    const wrapper = mount(ModelCreatePage, mountOptions);
    const exposed = wrapper.vm as unknown as { submit: (values: CreateSubmitPayload) => Promise<void> };
    await exposed.submit({ name: "Docs", description: "All docs", isPublic: false });

    expect(pushMock).toHaveBeenCalledWith("/models/model_new");
  });

  it("loads model detail and associated fields", async () => {
    routeParams.modelId = "model_3";
    mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_3",
            name: "Landing",
            description: "Landing pages",
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 1,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [
          {
            id: "field_1",
            name: "title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: true,
            isPrivate: false,
          },
        ],
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    expect(wrapper.text()).toContain("Landing");
    expect(wrapper.text()).toContain("title");
    expect(wrapper.findAll(".stat-card")).toHaveLength(1);

    const summaryCard = wrapper.find(".stat-card--summary");
    expect(summaryCard.exists()).toBe(true);
    expect(summaryCard.findAll(".stat-meta-row")).toHaveLength(3);
    expect(summaryCard.text()).toContain("公開状態");
    expect(summaryCard.text()).toContain("作成日");
    expect(summaryCard.text()).toContain("更新日");
    expect(wrapper.find(".save-hint").exists()).toBe(false);
  });

  it("opens a model edit dialog and persists title and description", async () => {
    routeParams.modelId = "model_dialog_edit_1";
    const fetchMock = mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_dialog_edit_1",
            name: "Landing",
            description: "Landing pages",
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 1,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [
          {
            id: "field_1",
            name: "title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: false,
            isPrivate: false,
            position: 0,
          },
        ],
      },
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_dialog_edit_1",
            name: "Updated",
            description: "Updated description",
            isPublic: true,
            titleFieldId: null,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            fieldsCount: 1,
          },
        },
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    expect(wrapper.find(".inline-edit-card").exists()).toBe(false);
    expect(wrapper.find(".header-actions .delete-button").exists()).toBe(false);

    await wrapper.get(".edit-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".edit-model-dialog").exists()).toBe(true);
    expect(wrapper.get(".edit-dialog-delete-button").text()).toContain("削除");

    const editForm = wrapper.findComponent({ name: "ModelEditFormStub" });
    expect(editForm.props("showPublicField")).toBe(false);

    editForm.vm.$emit("dirty-change", true);
    editForm.vm.$emit("valid-change", true);
    await flushPromises();

    await wrapper.get(".save-model-button").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const putCall = fetchMock.mock.calls[2];
    expect(putCall?.[0]).toBe("/api/admin/models/model_dialog_edit_1");
    const init = putCall?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(
      JSON.stringify({
        name: "Updated",
        description: "Updated description",
        isPublic: true,
        titleFieldId: null,
      }),
    );

    expect(wrapper.find(".edit-model-dialog").exists()).toBe(false);
    expect(wrapper.text()).toContain("Updated");
  });

  it("opens the delete confirmation from the model edit dialog header", async () => {
    routeParams.modelId = "model_dialog_delete_1";
    const fetchMock = mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_dialog_delete_1",
            name: "Landing",
            description: "Landing pages",
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 0,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [],
      },
      {
        ok: true,
        status: 200,
        body: { dependencies: [] },
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    await wrapper.get(".edit-button").trigger("click");
    await flushPromises();

    await wrapper.get(".edit-dialog-delete-button").trigger("click");
    await flushPromises();

    expect(wrapper.find(".edit-model-dialog").exists()).toBe(false);
    expect(wrapper.find(".delete-model-dialog").exists()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/admin/models/model_dialog_delete_1/dependencies");
  });

  it("keeps reordered fields pending until the save button is pressed", async () => {
    routeParams.modelId = "model_reorder_1";
    const fetchMock = mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_reorder_1",
            name: "Articles",
            description: "Blog posts",
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 2,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [
          {
            id: "field_title",
            name: "Title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: false,
            isPrivate: false,
            position: 0,
          },
          {
            id: "field_body",
            name: "Body",
            fieldKey: "body",
            type: "rich_text",
            required: false,
            hasLocales: false,
            isPrivate: false,
            position: 1,
          },
        ],
      },
      {
        ok: true,
        status: 200,
        body: { success: true },
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    const fieldsTable = wrapper.findComponent({ name: "ModelFieldsTableStub" });
    expect(fieldsTable.props("editingInline")).toBe(false);

    fieldsTable.vm.$emit("row-reorder", [...(fieldsTable.props("fields") as Array<{ id: string }>)].reverse());
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".save-button").text()).toContain("変更を保存");

    await wrapper.get(".save-button").trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const patchCall = fetchMock.mock.calls[2];
    expect(patchCall?.[0]).toBe("/api/admin/models/model_reorder_1/fields/order");
    const init = patchCall?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(
      JSON.stringify({
        orders: [
          { fieldId: "field_body", position: 0 },
          { fieldId: "field_title", position: 1 },
        ],
      }),
    );
  });

  it("creates a new field via API and updates the list", async () => {
    routeParams.modelId = "model_4";
    const fetchMock = mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_4",
            name: "Pages",
            description: "Landing pages",
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 0,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [],
      },
      {
        ok: true,
        status: 201,
        body: {
          id: "field_new",
          name: "Title",
          fieldKey: "title",
          type: "text",
          required: true,
          hasLocales: false,
          isPrivate: false,
          isDisplayTitle: true,
        },
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    const dialog = wrapper.findComponent({ name: "ModelFieldCreateDialogStub" });
    const payload = {
      type: "text",
      name: "Title",
      fieldKey: "title",
      required: true,
      hasLocales: false,
      variant: null,
      options: null,
      defaultValue: null,
      isPrivate: false,
    } as const;

    dialog.vm.$emit("submit", payload);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const postCall = fetchMock.mock.calls[2];
    expect(postCall?.[0]).toBe("/api/admin/models/model_4/fields");
    const init = postCall?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toBeInstanceOf(Headers);
    expect(init?.body).toBe(
      JSON.stringify({
        name: "Title",
        fieldKey: "title",
        type: "text",
        required: true,
        hasLocales: false,
        variant: null,
        options: null,
        defaultValue: null,
        isPrivate: false,
        position: 0,
      }),
    );

    await flushPromises();

    expect(wrapper.text()).toContain("Title");
    const fieldsTable = wrapper.findComponent({ name: "ModelFieldsTableStub" });
    expect(fieldsTable.props("titleFieldId")).toBe("field_new");
    expect((fieldsTable.props("fields") as Array<{ isDisplayTitle?: boolean }>)[0]?.isDisplayTitle).toBe(true);
    expect(toastAddMock).toHaveBeenCalled();
  });

  it("opens edit dialog from detail page and persists changes", async () => {
    routeParams.modelId = "model_edit_1";
    const fetchMock = mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_edit_1",
            name: "Pages",
            description: "Landing pages",
            isPublic: true,
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 1,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [
          {
            id: "field_1",
            name: "Title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: false,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: "",
            position: 0,
            isDisplayTitle: false,
          },
        ],
      },
      {
        ok: true,
        status: 200,
        body: { success: true },
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    const editButtons = wrapper.findAll(".edit-field-button");
    expect(editButtons).toHaveLength(1);

    await editButtons[0].trigger("click");
    await flushPromises();

    const dialog = wrapper.findComponent({ name: "ModelFieldEditDialogStub" });
    expect(dialog.exists()).toBe(true);

    dialog.vm.$emit("update-field", {
      id: "field_1",
      name: "Title Updated",
      fieldKey: "title_updated",
      type: "text",
      required: true,
      hasLocales: false,
      variant: null,
      options: null,
      defaultValue: "",
      isPrivate: false,
      position: 0,
      isDisplayTitle: false,
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const putCall = fetchMock.mock.calls[2];
    expect(putCall?.[0]).toBe("/api/admin/models/model_edit_1/fields/field_1");
    const putInit = putCall?.[1] as RequestInit | undefined;
    expect(putInit?.method).toBe("PUT");
    expect(putInit?.headers).toBeInstanceOf(Headers);
    expect(putInit?.body).toBe(
      JSON.stringify({
        name: "Title Updated",
        fieldKey: "title_updated",
        type: "text",
        required: true,
        hasLocales: false,
        variant: null,
        options: null,
        defaultValue: "",
        isPrivate: false,
        position: 0,
        isDisplayTitle: false,
      }),
    );

    expect(wrapper.text()).toContain("Title Updated");
    expect(toastAddMock).toHaveBeenCalled();
  });

  it("deletes a field from the detail page", async () => {
    routeParams.modelId = "model_delete_field_1";
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = mockFetch([
      {
        ok: true,
        status: 200,
        body: {
          item: {
            id: "model_delete_field_1",
            name: "Pages",
            description: "Landing pages",
            isPublic: true,
            titleFieldId: "field_1",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-24T00:00:00.000Z",
            fieldsCount: 2,
          },
        },
      },
      {
        ok: true,
        status: 200,
        body: [
          {
            id: "field_1",
            name: "Title",
            fieldKey: "title",
            type: "text",
            required: true,
            hasLocales: false,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: "",
            position: 0,
            isDisplayTitle: true,
          },
          {
            id: "field_2",
            name: "Body",
            fieldKey: "body",
            type: "rich_text",
            required: false,
            hasLocales: false,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: null,
            position: 1,
            isDisplayTitle: false,
          },
        ],
      },
      {
        ok: true,
        status: 204,
        body: null,
      },
    ]);

    const wrapper = mount(ModelDetailPage, mountOptions);
    await flushPromises();

    const deleteButtons = wrapper.findAll(".delete-field-button");
    expect(deleteButtons).toHaveLength(2);

    await deleteButtons[0].trigger("click");
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledWith("「Title」フィールドを削除しますか？この操作は元に戻せません。");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const deleteCall = fetchMock.mock.calls[2];
    expect(deleteCall?.[0]).toBe("/api/admin/models/model_delete_field_1/fields/field_1");
    expect((deleteCall?.[1] as RequestInit | undefined)?.method).toBe("DELETE");

    const fieldsTable = wrapper.findComponent({ name: "ModelFieldsTableStub" });
    const tableFields = fieldsTable.props("fields") as Array<{ id: string; name: string; position: number; isDisplayTitle?: boolean }>;
    expect(tableFields).toEqual([
      expect.objectContaining({
        id: "field_2",
        name: "Body",
        position: 0,
        isDisplayTitle: false,
      }),
    ]);
    expect(fieldsTable.props("titleFieldId")).toBeNull();
    expect(toastAddMock).toHaveBeenCalled();
  });
});
