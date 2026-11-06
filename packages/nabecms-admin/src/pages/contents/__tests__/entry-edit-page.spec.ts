import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h, reactive, type PropType } from "vue";
import EntryEditPage from "../EntryEditor.vue";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import { formatLocalizedDateTime } from "@/utils/dateTime";
import { authorizedFetch } from "@/utils/http";
import { referenceActionsId } from "../entry-edit/referenceSession";

vi.mock("@/utils/http", () => ({
  authorizedFetch: vi.fn(),
}));

const pushMock = vi.fn();
const backMock = vi.fn();
const removeRouteGuardMock = vi.fn();
type RouteLeaveGuard = (to: unknown, from: unknown, next: (value?: false) => void) => void;
let routeLeaveGuard: RouteLeaveGuard | null = null;
const routerBeforeEachMock = vi.fn((guard: RouteLeaveGuard) => {
  routeLeaveGuard = guard;
  return removeRouteGuardMock;
});
const toastAddMock = vi.fn();
const confirmRequireMock = vi.fn();
const entryFormResetDirtyMock = vi.fn();
const entryFormTriggerActionMock = vi.fn();
const routeParams = reactive<{ modelId: string; entryId: string }>({
  modelId: "model_posts",
  entryId: "entry_1",
});
let entryFormValuesOverride: Record<string, unknown> | null = null;

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushMock, back: backMock, beforeEach: routerBeforeEachMock }),
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
  useConfirm: () => ({ require: confirmRequireMock }),
}));

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

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
    inputIdPrefix: { type: String, default: "" },
    loading: { type: Boolean, default: false },
    mode: { type: String, default: "edit" },
  },
  emits: ["submit", "cancel", "dirty-change", "save-draft", "publish"],
  setup(props, { emit, expose }) {
    const formValues = () => ({
      ...(entryFormValuesOverride ?? {
        status: "published",
        title: { [props.defaultLocale]: "Updated title" },
        content: {
          [props.defaultLocale]: {
            type: "rich_text",
            value: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }] },
          },
        },
        featured: true,
      }),
    });
    expose({
      triggerAction: (action: "draft" | "publish") => {
        entryFormTriggerActionMock(action);
        emit(action === "draft" ? "save-draft" : "publish", formValues());
      },
      resetDirty: () => {
        entryFormResetDirtyMock();
        emit("dirty-change", false);
      },
    });
    return () =>
      h(
        "form",
        {
          onSubmit: (event: Event) => {
            event.preventDefault();
            emit("submit", formValues());
          },
        },
        [h("button", { type: "submit" }, "submit")],
      );
  },
});

const stubs = {
  Breadcrumb: BreadcrumbStub,
  EntryForm: EntryFormStub,
  Tabs: defineComponent({
    name: "TabsStub",
    props: { value: { type: String, default: "" } },
    emits: ["update:value"],
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
  TabList: defineComponent({
    name: "TabListStub",
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
  Tab: defineComponent({
    name: "TabStub",
    props: { value: { type: String, default: "" } },
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
  TabPanels: defineComponent({
    name: "TabPanelsStub",
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
  TabPanel: defineComponent({
    name: "TabPanelStub",
    props: { value: { type: String, default: "" } },
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
  Button: defineComponent({
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
  }),
  Dialog: defineComponent({
    name: "DialogStub",
    props: { visible: { type: Boolean, default: false } },
    setup(props, { slots }) {
      return () => (props.visible ? h("section", [slots.default?.(), slots.footer?.()]) : null);
    },
  }),
  RadioButton: defineComponent({
    name: "RadioButtonStub",
    props: {
      inputId: { type: String, default: "" },
      modelValue: { type: String, default: null },
      value: { type: String, default: "" },
      disabled: { type: Boolean, default: false },
    },
    emits: ["update:modelValue"],
    setup(props, { emit }) {
      return () =>
        h("input", {
          id: props.inputId,
          type: "radio",
          value: props.value,
          checked: props.modelValue === props.value,
          disabled: props.disabled,
          onChange: () => emit("update:modelValue", props.value),
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
  ConfirmDialog: defineComponent({
    name: "ConfirmDialogStub",
    setup() {
      return () => null;
    },
  }),
  Card: defineComponent({
    name: "CardStub",
    setup(_props, { slots }) {
      return () => slots.default?.();
    },
  }),
};

describe("EntryEditPage", () => {
  const authorizedFetchMock = vi.mocked(authorizedFetch);

  beforeEach(() => {
    vi.restoreAllMocks();
    authorizedFetchMock.mockReset();
    pushMock.mockReset();
    backMock.mockReset();
    removeRouteGuardMock.mockReset();
    routeLeaveGuard = null;
    routerBeforeEachMock.mockReset();
    routerBeforeEachMock.mockImplementation((guard: RouteLeaveGuard) => {
      routeLeaveGuard = guard;
      return removeRouteGuardMock;
    });
    toastAddMock.mockReset();
    confirmRequireMock.mockReset();
    entryFormResetDirtyMock.mockReset();
    entryFormTriggerActionMock.mockReset();
    entryFormValuesOverride = null;
    setActivePinia(createPinia());
    const store = useAuthStore();
    store.$patch({ accessToken: "token_abc" });
  });

  it.each([403, 404])("does not expose an editor when the entry request returns %s", async (status) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    authorizedFetchMock.mockImplementation(async (_store, url) => {
      if (url === "/api/admin/models/model_posts/entries/entry_1") return jsonResponse({ error: { code: "UNAVAILABLE" } }, status);
      if (url === "/api/admin/models/model_posts") return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      return jsonResponse({ items: [] });
    });
    const wrapper = mount(EntryEditPage, {
      props: { modelId: routeParams.modelId, entryId: routeParams.entryId, embedded: true },
      global: { plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })], stubs },
    });
    await flushPromises();
    expect(wrapper.findComponent(EntryFormStub).exists()).toBe(false);
    expect(wrapper.text()).toContain(ja.contents.edit.error_fetch_message);
    wrapper.unmount();
    log.mockRestore();
  });

  it.each([
    { modelId: "victim?", entryId: "entry_1" },
    { modelId: "../models/victim#", entryId: "entry_1" },
    { modelId: "victim", entryId: "../../victim?" },
  ])("does not turn an entry operation into a model request for $modelId / $entryId", async (target) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrongDeletes: string[] = [];
    authorizedFetchMock.mockImplementation(async (_store, input, init) => {
      const url = new URL(String(input), "https://cms.example.test");
      if (url.pathname === "/api/admin/models/victim") {
        if (init?.method === "DELETE") wrongDeletes.push(url.pathname);
        return jsonResponse({ item: { id: "victim", name: "Victim model" } });
      }
      if (url.pathname === "/api/admin/models/victim/fields") return jsonResponse([]);
      if (url.pathname.startsWith("/api/admin/models/")) return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      return jsonResponse({ items: [] });
    });
    const wrapper = mount(EntryEditPage, {
      props: { ...target, embedded: true },
      global: { plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })], stubs: { ...stubs, teleport: true } },
    });
    await flushPromises();
    if (wrapper.findComponent(EntryFormStub).exists()) {
      await (wrapper.vm as unknown as { deleteEntry: () => Promise<void> }).deleteEntry();
      await flushPromises();
      confirmRequireMock.mock.lastCall?.[0].accept();
      await flushPromises();
    }
    expect(wrongDeletes).toEqual([]);
    expect(wrapper.findComponent(EntryFormStub).exists()).toBe(false);
    expect(wrapper.text()).toContain(ja.contents.edit.error_fetch_message);
    wrapper.unmount();
    log.mockRestore();
  });

  it.each(["legacy/entry", "entry.with.dots", "entry?x#f", "entry'quote\"x\\y"])(
    "teleports embedded controls to the exact opaque entry ID %j",
    async (entryId) => {
      const target = { modelId: "model_legacy", entryId };
      const actions = document.createElement("div");
      actions.id = referenceActionsId(target);
      document.body.append(actions);
      authorizedFetchMock.mockImplementation(async (_store, input) => {
        const url = new URL(String(input), "https://cms.example.test");
        if (url.pathname.endsWith("/fields")) return jsonResponse([]);
        if (url.pathname.endsWith("/revisions")) return jsonResponse({ items: [] });
        if (url.pathname.includes("/entries/")) return jsonResponse({ item: { id: entryId, modelId: target.modelId, status: "draft", fields: [] } });
        if (url.pathname.startsWith("/api/admin/models/")) return jsonResponse({ item: { id: target.modelId, name: "Legacy model" } });
        return jsonResponse({ items: [] });
      });
      let wrapper: ReturnType<typeof mount> | undefined;
      try {
        wrapper = mount(EntryEditPage, {
          props: { ...target, embedded: true },
          global: { plugins: [createI18n({ legacy: false, locale: "ja", messages: { ja } })], stubs },
        });
        await flushPromises();
        expect(wrapper.findComponent(EntryFormStub).exists()).toBe(true);
        expect(actions.querySelector(".workflow-actions")).not.toBeNull();
      } finally {
        wrapper?.unmount();
        actions.remove();
      }
    },
  );

  it("shows the draft changes badge only when the draft form is dirty", async () => {
    authorizedFetchMock.mockImplementation(async (_store, url) => {
      if (url === "/api/admin/models/model_posts") {
        return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      }
      if (url === "/api/admin/models/model_posts/fields") {
        return jsonResponse([
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
        ]);
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1") {
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            publishedRevisionId: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
          draft: {
            revisionId: "revision_draft",
            revisionNumber: 1,
            createdAt: "2025-09-25T00:00:00.000Z",
            publishedAt: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
        });
      }
      if (url === "/api/admin/locales") {
        return jsonResponse({ items: [{ code: "en", isDefault: true }] });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      throw new Error(`Unexpected request for ${String(url)}`);
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    const chips = wrapper.findAll(".status-chip").map((chip) => chip.text());
    expect(chips).toEqual([ja.contents.entries.status_draft]);
    expect(wrapper.text()).not.toContain(ja.contents.edit.draft_badge);

    const draftForm = wrapper.findAllComponents(EntryFormStub).at(-1);
    expect(draftForm).toBeTruthy();
    draftForm!.vm.$emit("dirty-change", true);
    await flushPromises();

    const dirtyChips = wrapper.findAll(".status-chip").map((chip) => chip.text());
    expect(dirtyChips).toEqual([ja.contents.entries.status_draft, ja.contents.edit.draft_badge]);
  });

  it("asks for confirmation before publishing an entry", async () => {
    let publishPayload: Record<string, unknown> | null = null;
    const fields = [
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
        id: "field_content",
        name: "content",
        fieldKey: "content",
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
    ];

    authorizedFetchMock.mockImplementation(async (_store, url, init) => {
      if (url === "/api/admin/models/model_posts") {
        return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      }
      if (url === "/api/admin/models/model_posts/fields") {
        return jsonResponse(fields);
      }
      if (url === "/api/admin/locales") {
        return jsonResponse({ items: [{ code: "en", isDefault: true }] });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1" && (init as RequestInit | undefined)?.method === "PUT") {
        publishPayload = JSON.parse(String((init as RequestInit).body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "published",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            publishedAt: "2025-09-26T12:00:00.000Z",
          },
        });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1") {
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            publishedRevisionId: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
          draft: {
            revisionId: "revision_draft",
            revisionNumber: 1,
            createdAt: "2025-09-25T00:00:00.000Z",
            publishedAt: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
        });
      }
      throw new Error(`Unexpected request for ${String(url)}`);
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    const publishButton = wrapper.findAll(".workflow-actions button").find((button) => button.text().includes(ja.contents.edit.publish_button));
    expect(publishButton).toBeTruthy();
    await publishButton!.trigger("click");
    await flushPromises();

    expect(entryFormTriggerActionMock).toHaveBeenCalledWith("publish");
    expect(confirmRequireMock).toHaveBeenCalledWith(
      expect.objectContaining({
        header: ja.contents.edit.confirm_publish_title,
        message: ja.contents.edit.confirm_publish_message,
        acceptLabel: ja.contents.edit.publish_button,
        rejectLabel: ja.common.cancel,
        accept: expect.any(Function),
      }),
    );
    expect(publishPayload).toBeNull();

    const confirmOptions = confirmRequireMock.mock.calls[0]?.[0] as { accept?: () => void } | undefined;
    confirmOptions?.accept?.();
    await flushPromises();

    expect(publishPayload).toEqual(expect.objectContaining({ status: "published" }));
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ summary: ja.contents.edit.publish_success_title }));
  });

  it("warns before publishing when relation or rich text fields reference draft entries", async () => {
    const fields = [
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
        id: "field_author",
        name: "author",
        fieldKey: "author",
        type: "relation",
        required: false,
        hasLocales: false,
        isPrivate: false,
        variant: "many",
        options: { allowedModels: ["model_authors"] },
        defaultValue: null,
        position: 1,
        isDisplayTitle: false,
      },
      {
        id: "field_content",
        name: "content",
        fieldKey: "content",
        type: "rich_text",
        required: true,
        hasLocales: true,
        isPrivate: false,
        variant: null,
        options: null,
        defaultValue: null,
        position: 2,
        isDisplayTitle: false,
      },
    ];

    entryFormValuesOverride = {
      status: "published",
      title: { en: "Updated title" },
      author: { type: "many", entryIds: ["entry_author_draft"] },
      content: {
        en: {
          type: "rich_text",
          value: {
            type: "doc",
            content: [{ type: "entryReference", attrs: { entryId: "entry_embed_draft" } }],
          },
        },
      },
    };

    authorizedFetchMock.mockImplementation(async (_store, url) => {
      if (url === "/api/admin/models/model_posts") {
        return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      }
      if (url === "/api/admin/models/model_posts/fields") {
        return jsonResponse(fields);
      }
      if (url === "/api/admin/locales") {
        return jsonResponse({ items: [{ code: "en", isDefault: true }] });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      if (url === "/api/admin/entry-references?entryId=entry_author_draft&entryId=entry_embed_draft") {
        return jsonResponse({
          items: [
            {
              entryId: "entry_author_draft",
              modelId: "model_authors",
              modelName: "Authors",
              displayTitle: "Draft author",
              status: "draft",
            },
            {
              entryId: "entry_embed_draft",
              modelId: "model_cards",
              modelName: "Cards",
              displayTitle: "Draft embed",
              status: "draft",
            },
          ],
        });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1") {
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            publishedRevisionId: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
          draft: {
            revisionId: "revision_draft",
            revisionNumber: 1,
            createdAt: "2025-09-25T00:00:00.000Z",
            publishedAt: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
        });
      }
      throw new Error(`Unexpected request for ${String(url)}`);
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    const publishButton = wrapper.findAll(".workflow-actions button").find((button) => button.text().includes(ja.contents.edit.publish_button));
    expect(publishButton).toBeTruthy();
    await publishButton!.trigger("click");
    await flushPromises();

    expect(confirmRequireMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `${ja.contents.edit.confirm_publish_message}\n\n${ja.contents.edit.confirm_publish_draft_reference_warning}`,
      }),
    );
  });

  it("updates entry via API and stays on page", async () => {
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({ item: { id: "model_posts", name: "Posts" } }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => [
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
            id: "field_content",
            name: "content",
            fieldKey: "content",
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
        ],
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            fields: [
              { fieldId: "field_title", locale: "en", type: "text", value: "Initial title" },
              { fieldId: "field_content", locale: "en", type: "rich_text", value: { type: "rich_text", value: { type: "doc" } } },
            ],
          },
        }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ code: "en", isDefault: true }] }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "published",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            publishedAt: "2025-09-26T12:00:00.000Z",
          },
        }),
        text: async () => "",
      },
      // Re-fetch after update: model, fields, entry
      {
        ok: true,
        status: 200,
        json: async () => ({ item: { id: "model_posts", name: "Posts" } }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => [
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
            id: "field_content",
            name: "content",
            fieldKey: "content",
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
        ],
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "published",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            updatedBy: "user_editor",
            updatedByName: "Editor",
            publishedAt: "2025-09-26T12:00:00.000Z",
            fields: [
              { fieldId: "field_title", locale: "en", type: "text", value: "Updated title" },
              { fieldId: "field_content", locale: "en", type: "rich_text", value: { type: "rich_text", value: { type: "doc" } } },
            ],
          },
        }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ code: "en", isDefault: true }] }),
        text: async () => "",
      },
    ];

    authorizedFetchMock.mockImplementation(async (_store, url, init) => {
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      const next = responses.shift();
      if (!next) throw new Error("No more mock responses");
      if (init && (init as RequestInit).method === "PUT") {
        // ensure JSON body consumed in expectations by returning matching response
        return next as Response;
      }
      return next as Response;
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    const metaItems = wrapper.findAll(".meta-grid .meta-item").map((item) => item.text());
    expect(metaItems).toHaveLength(4);
    expect(metaItems[0]).toContain(ja.contents.edit.meta_created);
    expect(metaItems[1]).toContain(ja.contents.edit.meta_updated);
    expect(metaItems[2]).toContain(ja.contents.edit.meta_published);
    expect(metaItems[3]).toContain(ja.contents.edit.meta_updated_by);
    expect(wrapper.get(".meta-grid").text()).toContain(ja.contents.edit.meta_created);
    expect(wrapper.get(".meta-grid").text()).toContain(ja.contents.edit.meta_updated);
    expect(wrapper.get(".meta-grid").text()).toContain(ja.contents.edit.meta_updated_by);
    expect(wrapper.get(".meta-grid").text()).toContain(ja.contents.edit.meta_published);
    expect(wrapper.get(".meta-actions").exists()).toBe(true);
    expect(wrapper.findAll(".meta-actions button")).toHaveLength(2);
    expect(wrapper.find(".page-section-header__actions").exists()).toBe(false);
    expect(wrapper.get(".workflow-actions").text()).toContain(ja.contents.edit.delete);
    expect(wrapper.findAll(".workflow-actions button")).toHaveLength(3);

    const forms = wrapper.findAll("form");
    expect(forms.length).toBeGreaterThan(0);

    const draftForm = wrapper.findAllComponents(EntryFormStub).at(-1);
    expect(draftForm).toBeTruthy();
    draftForm!.vm.$emit("dirty-change", true);
    await flushPromises();

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const blockedNext = vi.fn();
    expect(routeLeaveGuard).toBeTruthy();
    routeLeaveGuard!({}, {}, blockedNext);
    expect(confirmSpy).toHaveBeenCalledWith(ja.contents.edit.unsaved_confirm);
    expect(blockedNext).toHaveBeenCalledWith(false);
    confirmSpy.mockClear();

    await forms[forms.length - 1].trigger("submit.prevent");
    await flushPromises();

    expect(authorizedFetchMock.mock.calls).toEqual(
      expect.arrayContaining([[expect.anything(), "/api/admin/models/model_posts/entries/entry_1", expect.objectContaining({ method: "PUT" })]]),
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(entryFormResetDirtyMock).toHaveBeenCalledTimes(1);
    const allowedNext = vi.fn();
    routeLeaveGuard!({}, {}, allowedNext);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(allowedNext).toHaveBeenCalledWith();
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ summary: ja.contents.edit.draft_save_success_title }));
  });

  it("ignores legacy scheduled publishing data without probing schedule endpoints", async () => {
    const fields = [
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
    ];
    authorizedFetchMock.mockImplementation(async (_store, url) => {
      if (url === "/api/admin/models/model_posts") {
        return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      }
      if (url === "/api/admin/models/model_posts/fields") {
        return jsonResponse(fields);
      }
      if (url === "/api/admin/locales") {
        return jsonResponse({ items: [{ code: "en", isDefault: true }] });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({
          items: [
            {
              id: "schedule_1",
              action: "publish",
              status: "pending",
              scheduledAt: "2099-01-01T01:30:00.000Z",
              revisionId: "revision_draft",
              error: null,
            },
          ],
        });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1") {
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            publishedRevisionId: null,
            activeSchedules: [
              {
                id: "schedule_legacy",
                action: "unpublish",
                status: "pending",
                scheduledAt: "2099-01-01T01:30:00.000Z",
              },
            ],
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Initial title" }],
          },
          draft: {
            revisionId: "revision_draft",
            revisionNumber: 2,
            createdAt: "2025-09-25T00:00:00.000Z",
            publishedAt: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Draft title" }],
          },
        });
      }
      throw new Error(`Unexpected request for ${String(url)}`);
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    expect(wrapper.text()).not.toContain(ja.contents.edit.schedule_button);
    expect(wrapper.find(".schedule-summary").exists()).toBe(false);
    expect(wrapper.find("#scheduled-at").exists()).toBe(false);
    const scheduleCalls = authorizedFetchMock.mock.calls.filter(
      ([, url]) => String(url).includes("publication-schedules") || String(url).endsWith("/schedules"),
    );
    expect(scheduleCalls).toEqual([]);
  });

  it("preloads referenced entry metadata when entry detail includes IDs", async () => {
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({ item: { id: "model_posts", name: "Posts" } }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "field_content",
            name: "content",
            fieldKey: "content",
            type: "rich_text",
            required: true,
            hasLocales: true,
            isPrivate: false,
            variant: null,
            options: null,
            defaultValue: null,
            position: 0,
            isDisplayTitle: false,
          },
        ],
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            fields: [
              {
                fieldId: "field_content",
                locale: "en",
                type: "rich_text",
                value: { type: "rich_text", value: { type: "doc", content: [{ type: "entryReference", attrs: { entryId: "entry_related" } }] } },
              },
            ],
          },
          referencedEntryIds: ["entry_related"],
        }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ code: "en", isDefault: true }] }),
        text: async () => "",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              entryId: "entry_related",
              modelId: "model_related",
              modelName: "Related",
              displayTitle: "Related Entry",
            },
          ],
        }),
        text: async () => "",
      },
    ];

    authorizedFetchMock.mockImplementation(async (_store, url) => {
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      const next = responses.shift();
      if (!next) {
        throw new Error(`Unexpected request for ${url}`);
      }
      return next as Response;
    });

    mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    const requestedUrls = authorizedFetchMock.mock.calls.map(([, url]) => url);
    expect(requestedUrls).toContain("/api/admin/entry-references?entryId=entry_related");
    expect(responses).toHaveLength(0);
  });

  it("does not keep stale entry locales that are not configured", async () => {
    const fields = [
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
    ];
    let updatePayload: Record<string, unknown> | null = null;

    authorizedFetchMock.mockImplementation(async (_store, url, init) => {
      if (url === "/api/admin/models/model_posts") {
        return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      }
      if (url === "/api/admin/models/model_posts/fields") {
        return jsonResponse(fields);
      }
      if (url === "/api/admin/locales") {
        return jsonResponse({ items: [{ code: "ja-JP", isDefault: true }] });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({ items: [] });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1" && (init as RequestInit | undefined)?.method === "PUT") {
        updatePayload = JSON.parse(String((init as RequestInit).body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            publishedAt: null,
          },
        });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1") {
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Stale title" }],
          },
          draft: {
            revisionId: "revision_draft",
            revisionNumber: 2,
            createdAt: "2025-09-25T00:00:00.000Z",
            publishedAt: null,
            fields: [{ fieldId: "field_title", locale: "en", type: "text", value: "Stale draft title" }],
          },
        });
      }
      throw new Error(`Unexpected request for ${String(url)}`);
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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

    expect(wrapper.find(".draft-banner").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("下書きは");

    const entryForms = wrapper.findAllComponents(EntryFormStub);
    const draftForm = entryForms[entryForms.length - 1]!;
    expect(draftForm.props("locales")).toEqual([{ code: "ja-JP", isDefault: true }]);
    expect(draftForm.props("defaultLocale")).toBe("ja-JP");

    const forms = wrapper.findAll("form");
    await forms[forms.length - 1].trigger("submit.prevent");
    await flushPromises();

    expect(updatePayload?.fields).toEqual([expect.objectContaining({ fieldId: "field_title", locale: "ja-JP", value: "Updated title" })]);
  });

  it("restores a selected historical revision as a new draft", async () => {
    let restored = false;
    const currentRevisionCreatedAt = "2025-09-26T12:00:00.000Z";
    const historicalRevisionCreatedAt = "2025-09-20T00:00:00.000Z";
    const fields = [
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
    ];

    authorizedFetchMock.mockImplementation(async (_store, url, init) => {
      if (url === "/api/admin/models/model_posts") {
        return jsonResponse({ item: { id: "model_posts", name: "Posts" } });
      }
      if (url === "/api/admin/models/model_posts/fields") {
        return jsonResponse(fields);
      }
      if (url === "/api/admin/locales") {
        return jsonResponse({ items: [{ code: "en", isDefault: true }] });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions") {
        return jsonResponse({
          items: [
            {
              id: restored ? "revision_restored" : "revision_live",
              revisionNumber: restored ? 4 : 3,
              status: "draft",
              createdAt: currentRevisionCreatedAt,
              publishedAt: null,
              hasContent: true,
            },
            {
              id: "revision_old",
              revisionNumber: 1,
              status: "published",
              createdAt: historicalRevisionCreatedAt,
              publishedAt: "2025-09-21T00:00:00.000Z",
              hasContent: true,
            },
          ],
        });
      }
      if (String(url).startsWith("/api/admin/publication-schedules?")) {
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1/revisions/revision_old/restore" && (init as RequestInit | undefined)?.method === "POST") {
        restored = true;
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "published",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-26T12:00:00.000Z",
            publishedAt: "2025-09-21T00:00:00.000Z",
          },
        });
      }
      if (url === "/api/admin/models/model_posts/entries/entry_1") {
        return jsonResponse({
          item: {
            id: "entry_1",
            modelId: "model_posts",
            status: "published",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-25T00:00:00.000Z",
            updatedBy: "user_admin",
            updatedByName: "Admin",
            publishedAt: "2025-09-21T00:00:00.000Z",
            publishedRevisionId: "revision_live",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                value: "Live title",
              },
            ],
          },
          draft: restored
            ? {
                revisionId: "revision_restored",
                revisionNumber: 4,
                createdAt: "2025-09-26T12:00:00.000Z",
                publishedAt: null,
                fields: [
                  {
                    fieldId: "field_title",
                    locale: "en",
                    type: "text",
                    value: "Older title",
                  },
                ],
              }
            : null,
        });
      }
      throw new Error(`Unexpected request for ${String(url)}`);
    });

    const wrapper = mount(EntryEditPage, {
      props: {
        modelId: routeParams.modelId,
        entryId: routeParams.entryId,
      },
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
    const historyButton = wrapper.findAll("button").find((button) => button.text().includes(ja.contents.edit.history_button));
    expect(historyButton).toBeTruthy();
    await historyButton!.trigger("click");
    await flushPromises();
    expect(wrapper.findAll("button").some((button) => button.text().includes(ja.contents.edit.history_refresh))).toBe(false);
    const revisionListText = wrapper.find(".revision-list").text();
    expect(revisionListText).toContain(formatLocalizedDateTime(currentRevisionCreatedAt));
    expect(revisionListText).toContain(formatLocalizedDateTime(historicalRevisionCreatedAt));

    await wrapper.find('input[value="revision_old"]').setValue();
    await flushPromises();

    const restoreButton = wrapper.findAll("button").find((button) => button.text().includes(ja.contents.edit.history_restore_button));
    expect(restoreButton).toBeTruthy();
    await restoreButton!.trigger("click");

    expect(confirmRequireMock).toHaveBeenCalledWith(
      expect.objectContaining({
        header: ja.contents.edit.history_restore_confirm_title,
        accept: expect.any(Function),
      }),
    );

    const confirmOptions = confirmRequireMock.mock.calls[0]?.[0] as { accept?: () => void } | undefined;
    confirmOptions?.accept?.();
    await flushPromises();

    expect(authorizedFetchMock).toHaveBeenCalledWith(
      expect.anything(),
      "/api/admin/models/model_posts/entries/entry_1/revisions/revision_old/restore",
      expect.objectContaining({ method: "POST" }),
    );
    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: ja.contents.edit.history_restore_success_title,
      }),
    );
  });
});
