import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ja from "@/locales/ja.json";
import RolesPage from "../RolesPage.vue";
import { useAuthStore } from "@/stores/auth";

const toastAddMock = vi.fn();
const baseRoleItems = [
  {
    id: "role_super_admin",
    name: "Super Admin",
    description: "System reserved role with full privileges",
    permissions: { allow: ["*"] },
    isSystem: true,
    createdAt: "2026-04-30T08:23:11.000Z",
    updatedAt: "2026-04-30T08:23:11.000Z",
  },
  {
    id: "role_empty",
    name: "Empty",
    description: null,
    permissions: { allow: [] },
    isSystem: false,
    createdAt: "2026-04-30T08:23:11.000Z",
    updatedAt: "2026-04-30T08:23:11.000Z",
  },
];

vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: (path: string) => ({ href: path }),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
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
    return () => h("section", slots.content?.());
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

const InputTextStub = defineComponent({
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
});

const TextareaStub = defineComponent({
  name: "TextareaStub",
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("textarea", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
      });
  },
});

const CheckboxStub = defineComponent({
  name: "CheckboxStub",
  props: {
    modelValue: { type: Boolean, default: false },
    inputId: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        id: props.inputId,
        type: "checkbox",
        checked: props.modelValue,
        disabled: props.disabled,
        onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).checked),
      });
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
  PageSectionHeader: PageSectionHeaderStub,
  Card: CardStub,
  Tag: TagStub,
  Button: ButtonStub,
  InputText: InputTextStub,
  Textarea: TextareaStub,
  Checkbox: CheckboxStub,
  Dialog: DialogStub,
};

const createJsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => "",
  }) as Response;

const mockRolesResponse = (items = baseRoleItems) => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST" || init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      return createJsonResponse({
        role: {
          id: init.method === "POST" ? "role_created" : "role_updated",
          name: body.name,
          description: body.description ?? null,
          permissions: body.permissions,
          isSystem: false,
          createdAt: "2026-04-30T08:23:11.000Z",
          updatedAt: "2026-04-30T08:23:11.000Z",
        },
      });
    }
    return createJsonResponse({ items });
  });
  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
};

const mountRolesPage = () =>
  mount(RolesPage, {
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

const setAllMatrixCells = async (wrapper: ReturnType<typeof mountRolesPage>, checked: boolean): Promise<void> => {
  for (const checkbox of wrapper.findAll('[data-test^="permission-cell-"]')) {
    await checkbox.setValue(checked);
  }
};

describe("RolesPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastAddMock.mockReset();
    setActivePinia(createPinia());
    const authStore = useAuthStore();
    authStore.$patch({ accessToken: "token_abc" });
    mockRolesResponse();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps the all-permissions summary compact and renders other permissions as a table", async () => {
    const wrapper = mountRolesPage();

    await flushPromises();

    const permissions = wrapper.findAll(".permissions");
    expect({
      count: permissions.length,
      allPermissionsText: permissions[0].get(".permission-summary-group").text(),
      allPermissionsTable: permissions[0].find(".permission-summary-table").exists(),
      emptyPermissionsText: permissions[1].get(".permission-summary-table tbody td").text(),
      emptyPermissionsHeaders: permissions[1].findAll(".permission-summary-table thead th").map((header) => header.text()),
    }).toEqual({
      count: 2,
      allPermissionsText: "すべての権限",
      allPermissionsTable: false,
      emptyPermissionsText: "明示的な権限はありません",
      emptyPermissionsHeaders: ["対象", "許可"],
    });
  });

  it("renders selected permission groups as table rows", async () => {
    mockRolesResponse([
      {
        ...baseRoleItems[1],
        id: "role_editor",
        name: "Editor",
        permissions: {
          allow: ["entries:*:create", "entries:*:read", "models:*:read", "media:*:read", "media:*:write"],
        },
      },
    ]);
    const wrapper = mountRolesPage();

    await flushPromises();

    const rows = wrapper.findAll(".permission-summary-table tbody tr").map((row) => row.findAll("th, td").map((cell) => cell.text()));
    expect(rows).toEqual([
      ["エントリー", "作成, 閲覧"],
      ["モデルとフィールド", "閲覧"],
      ["メディア", "閲覧, 変更"],
    ]);
  });

  it("hides the delete action for system roles", async () => {
    const wrapper = mountRolesPage();

    await flushPromises();

    const roleHeaders = wrapper.findAll(".role-header");
    expect(roleHeaders).toHaveLength(2);
    expect(roleHeaders[0].text()).toContain("Super Admin");
    expect(roleHeaders[0].text()).not.toContain("削除");
    expect(roleHeaders[1].text()).toContain("Empty");
    expect(roleHeaders[1].text()).toContain("削除");
  });

  it("shows entry actions separately from admin read and write permissions", async () => {
    const wrapper = mountRolesPage();

    await flushPromises();
    await wrapper.get("header button").trigger("click");

    expect(wrapper.text()).toContain("エントリー");
    expect(wrapper.text()).toContain("作成");
    expect(wrapper.text()).toContain("公開");
    expect(wrapper.text()).toContain("管理リソース");
    expect(wrapper.text()).toContain("変更");
    expect(wrapper.find('[data-test="permission-cell-entries-publish"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="permission-cell-model_schema-write"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="permission-cell-invites-read"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="permission-cell-invites-write"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="permission-cell-logs-read"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="permission-cell-logs-write"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="permission-cell-webhooks-read"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="permission-cell-webhooks-write"]').exists()).toBe(false);
  });

  it("checks every matrix permission by default when creating a role", async () => {
    const wrapper = mountRolesPage();

    await flushPromises();
    await wrapper.get("header button").trigger("click");

    expect((wrapper.get("#permission-all").element as HTMLInputElement).checked).toBe(false);
    for (const checkbox of wrapper.findAll('[data-test^="permission-cell-"]')) {
      expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    }
  });

  it("converts selected matrix cells to permissions.allow", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const wrapper = mountRolesPage();

    await flushPromises();
    await wrapper.get("header button").trigger("click");
    await wrapper.get("#role-name").setValue("Editor");
    await setAllMatrixCells(wrapper, false);
    await wrapper.get('[data-test="permission-cell-entries-create"]').setValue(true);
    await wrapper.get('[data-test="permission-cell-entries-publish"]').setValue(true);
    await wrapper.get('[data-test="permission-cell-invites-write"]').setValue(true);
    await wrapper.get('[data-test="permission-cell-roles-write"]').setValue(true);
    await wrapper.get('[data-test="role-save"]').trigger("click");
    await flushPromises();

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(saveCall).toBeTruthy();
    const payload = JSON.parse(String(saveCall?.[1]?.body)) as { permissions: { allow: string[] } };
    expect(payload.permissions.allow).toEqual([
      "entries:*:create",
      "entries:*:publish",
      "entries:*:read",
      "users:invite:write",
      "roles:*:write",
      "roles:*:read",
    ]);
  });

  it("drops the deprecated invite read permission when editing a role", async () => {
    const fetchMock = mockRolesResponse([
      ...baseRoleItems,
      {
        id: "role_legacy_invite_read",
        name: "Legacy Invite Read",
        description: null,
        permissions: { allow: ["users:invite:read"] },
        isSystem: false,
        createdAt: "2026-04-30T08:23:11.000Z",
        updatedAt: "2026-04-30T08:23:11.000Z",
      },
    ]);
    const wrapper = mountRolesPage();

    await flushPromises();
    const customRole = wrapper.findAll(".role-header").find((item) => item.text().includes("Legacy Invite Read"));
    expect(customRole).toBeTruthy();
    await customRole!.find("button").trigger("click");

    expect(wrapper.find(".permissions-preserved").exists()).toBe(false);

    await wrapper.get('[data-test="role-save"]').trigger("click");
    await flushPromises();

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(saveCall).toBeTruthy();
    const payload = JSON.parse(String(saveCall?.[1]?.body)) as { permissions: { allow: string[] } };
    expect(payload.permissions.allow).toEqual([]);
  });

  it("drops legacy webhook permissions from role summaries and saved payloads", async () => {
    const fetchMock = mockRolesResponse([
      ...baseRoleItems,
      {
        id: "role_legacy_webhooks",
        name: "Legacy Webhooks",
        description: null,
        permissions: { allow: ["webhooks:*:read", "webhooks:*:write", "contents:preview"] },
        isSystem: false,
        createdAt: "2026-04-30T08:23:11.000Z",
        updatedAt: "2026-04-30T08:23:11.000Z",
      },
    ]);
    const wrapper = mountRolesPage();

    await flushPromises();
    const customRole = wrapper.findAll(".role-card").find((item) => item.text().includes("Legacy Webhooks"));
    expect(customRole).toBeTruthy();
    expect(customRole!.get(".permissions").text()).not.toContain(ja.settings.roles.permission_resource_webhooks);
    await customRole!.find("button").trigger("click");

    expect(wrapper.get(".permissions-preserved").text()).toContain("contents:preview");
    expect(wrapper.get(".permissions-preserved").text()).not.toContain("webhooks:");

    await wrapper.get('[data-test="role-save"]').trigger("click");
    await flushPromises();

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(saveCall).toBeTruthy();
    const payload = JSON.parse(String(saveCall?.[1]?.body)) as { permissions: { allow: string[] } };
    expect(payload.permissions.allow).toEqual(["contents:preview"]);
  });

  it("preserves rules that are not represented by the matrix", async () => {
    const fetchMock = mockRolesResponse([
      ...baseRoleItems,
      {
        id: "role_custom",
        name: "Custom",
        description: null,
        permissions: { allow: ["contents:preview", "settings:media:write"] },
        isSystem: false,
        createdAt: "2026-04-30T08:23:11.000Z",
        updatedAt: "2026-04-30T08:23:11.000Z",
      },
    ]);
    const wrapper = mountRolesPage();

    await flushPromises();
    const customRole = wrapper.findAll(".role-header").find((item) => item.text().includes("Custom"));
    expect(customRole).toBeTruthy();
    await customRole!.find("button").trigger("click");

    expect(wrapper.find(".permissions-preserved").text()).toContain("contents:preview");
    expect((wrapper.get('[data-test="permission-cell-media_settings-write"]').element as HTMLInputElement).checked).toBe(true);

    await wrapper.get('[data-test="role-save"]').trigger("click");
    await flushPromises();

    const saveCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(saveCall).toBeTruthy();
    const payload = JSON.parse(String(saveCall?.[1]?.body)) as { permissions: { allow: string[] } };
    expect(payload.permissions.allow).toContain("contents:preview");
    expect(payload.permissions.allow).toContain("settings:media:write");
  });
});
