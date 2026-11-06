import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { defineComponent, h, inject, provide, toRef, type PropType, type Ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ja from "@/locales/ja.json";
import type { UserItem } from "@/pages/settings/users-shared";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import UsersPage from "../UsersPage.vue";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: (path: string) => ({ href: path }),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: vi.fn() }),
}));

vi.mock("@/utils/http", () => ({
  authorizedFetch: vi.fn(),
}));

const PageSectionHeaderStub = defineComponent({
  name: "PageSectionHeaderStub",
  props: {
    title: { type: String, required: true },
  },
  setup(props, { slots }) {
    return () => h("header", { "data-test": "page-header" }, [h("h1", props.title), h("div", { "data-test": "page-header-actions" }, slots.actions?.())]);
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  emits: ["click"],
  setup(_props, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: typeof attrs.type === "string" ? attrs.type : "button",
          "data-label": typeof attrs.label === "string" ? attrs.label : "",
          disabled: attrs.disabled === true,
          onClick: () => emit("click"),
        },
        slots.default?.() ?? (typeof attrs.label === "string" ? attrs.label : ""),
      );
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  inheritAttrs: false,
  props: {
    header: { type: String, default: "" },
    visible: { type: Boolean, default: false },
  },
  emits: ["update:visible", "hide"],
  setup(props, { slots }) {
    return () => (props.visible ? h("section", { "data-stub": "Dialog" }, [h("h2", props.header), slots.default?.(), slots.footer?.()]) : null);
  },
});

const InputTextStub = defineComponent({
  name: "InputTextStub",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: undefined },
    value: { type: String, default: undefined },
  },
  emits: ["update:modelValue"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue ?? props.value ?? "",
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
      });
  },
});

const SelectStub = defineComponent({
  name: "SelectStub",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: null },
    optionLabel: { type: String, default: "label" },
    optionValue: { type: String, default: "value" },
    options: { type: Array, default: () => [] },
    placeholder: { type: String, default: "" },
  },
  setup(_props, { attrs }) {
    return () => h("select", attrs);
  },
});

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("section", [slots.title?.(), slots.content?.()]);
  },
});

const elTableRowsKey = Symbol("elTableRows");

const ElTableStub = defineComponent({
  name: "ElTableStub",
  props: {
    data: { type: Array as PropType<Array<Record<string, unknown>>>, default: () => [] },
  },
  setup(props, { slots }) {
    provide(elTableRowsKey, toRef(props, "data"));
    return () => h("div", { "data-stub": "ElTable" }, slots.default?.());
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumnStub",
  setup(_props, { slots }) {
    const rows = inject<Ref<Array<Record<string, unknown>>>>(elTableRowsKey);
    return () =>
      h(
        "div",
        { "data-stub": "ElTableColumn" },
        (rows?.value ?? []).map((row) => slots.default?.({ row })),
      );
  },
});

const stubs = {
  Button: ButtonStub,
  Card: CardStub,
  ElTable: ElTableStub,
  ElTableColumn: ElTableColumnStub,
  Dialog: DialogStub,
  InputText: InputTextStub,
  Listbox: true,
  NabeButton: ButtonStub,
  PageSectionHeader: PageSectionHeaderStub,
  Password: true,
  Select: SelectStub,
  Tag: true,
};

const authorizedFetchMock = vi.mocked(authorizedFetch);

/** Create a user row fixture with its deletable state derived from the system role. */
const createUserFixture = (isSystemUser: boolean): UserItem => ({
  id: isSystemUser ? "user_root" : "user_editor",
  email: isSystemUser ? "root@example.com" : "editor@example.com",
  name: isSystemUser ? "Root" : "Editor",
  roleIds: [isSystemUser ? "system.super-admin" : "role_admin"],
  createdAt: "2026-07-07T17:07:36.000Z",
  updatedAt: "2026-07-07T17:07:36.000Z",
  isSystemUser,
});

/** Mock the users-page requests with the supplied user rows. */
const mockUserList = (items: UserItem[]): void => {
  authorizedFetchMock.mockImplementation(async (_authStore, input) => {
    const path = String(input);
    if (path === "/api/admin/roles") {
      return createResponse({
        items: [
          { id: "system.super-admin", name: "Super Admin", description: null, isSystem: true },
          { id: "role_admin", name: "Admin", description: null, isSystem: false },
        ],
      });
    }
    if (path === "/api/admin/users") {
      return createResponse({ items });
    }
    if (path === "/api/admin/auth/invites") {
      return createResponse({ items: [] });
    }
    return createResponse({}, 404);
  });
};

/**
 * Create a fetch-like response object for page-level API mocks.
 */
const createResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => "",
  }) as Response;

/**
 * Mount the users page with authenticated state and lightweight UI stubs.
 */
const mountUsersPage = () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({ accessToken: "token_abc" });

  return mount(UsersPage, {
    global: {
      plugins: [
        pinia,
        createI18n({
          legacy: false,
          locale: "ja",
          messages: { ja },
        }),
      ],
      stubs,
    },
  });
};

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse({ passwordResetEnabled: true })),
    );
    authorizedFetchMock.mockImplementation(async (_authStore, input) => {
      const path = String(input);
      if (path === "/api/admin/roles") {
        return createResponse({ items: [{ id: "role_admin", name: "Admin", description: null, isSystem: false }] });
      }
      if (path === "/api/admin/users") {
        return createResponse({ items: [] });
      }
      if (path === "/api/admin/auth/invites") {
        return createResponse({ items: [] });
      }
      return createResponse({}, 404);
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("replaces password editing with the user's email reset flow", async () => {
    mockUserList([createUserFixture(false)]);
    const wrapper = mountUsersPage();
    await flushPromises();
    await wrapper.get('[data-label="編集"]').trigger("click");
    expect(wrapper.find("#user-password").exists()).toBe(false);
    expect(wrapper.get("#user-email").attributes("readonly")).toBeDefined();
    const help = wrapper.get('[data-testid="password-reset-help"]');
    expect(help.text()).toContain("本人が登録メールアドレスで受け取ったリンク");
    expect(help.get("a").attributes("href")).toBe("/auth/forgot-password");

    authorizedFetchMock.mockImplementation(async (_store, input, init) => {
      if (String(input).endsWith("/user_editor") && init?.method === "PUT")
        return createResponse({ user: { ...createUserFixture(false), name: "Updated editor" } });
      return createResponse({}, 404);
    });
    await wrapper.get("#user-name").setValue("Updated editor");
    await wrapper.get('[data-label="更新"]').trigger("click");
    await flushPromises();
    const call = authorizedFetchMock.mock.calls.find(([, , init]) => init?.method === "PUT");
    expect(JSON.parse(String(call?.[2]?.body))).toEqual({ name: "Updated editor" });
  });

  it("allows email editing only for the authenticated user's row", async () => {
    mockUserList([createUserFixture(false)]);
    const wrapper = mountUsersPage();
    useAuthStore().$patch({ user: { id: "user_editor", name: "Editor", email: "editor@example.com", roleId: ["role_admin"] } });
    await flushPromises();
    await wrapper.get('[data-label="編集"]').trigger("click");
    expect(wrapper.get("#user-email").attributes("readonly")).toBeUndefined();
    authorizedFetchMock.mockImplementation(async () => createResponse({ user: { ...createUserFixture(false), email: "new@example.com" } }));
    await wrapper.get("#user-email").setValue("new@example.com");
    await wrapper.get('[data-label="更新"]').trigger("click");
    await flushPromises();
    const call = authorizedFetchMock.mock.calls.find(([, , init]) => init?.method === "PUT");
    expect(JSON.parse(String(call?.[2]?.body))).toEqual({ name: "Editor", email: "new@example.com" });
  });

  it("explains unavailable recovery without restoring direct password editing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse({ passwordResetEnabled: false })),
    );
    mockUserList([createUserFixture(false)]);
    const wrapper = mountUsersPage();
    await flushPromises();
    await wrapper.get('[data-label="編集"]').trigger("click");
    const help = wrapper.get('[data-testid="password-reset-help"]');
    expect(help.text()).toContain("メールによる再設定は現在無効");
    expect(help.find("a").exists()).toBe(false);
    expect(wrapper.find("#user-password").exists()).toBe(false);
  });

  it("opens the invite dialog from the page header action", async () => {
    const wrapper = mountUsersPage();
    await flushPromises();

    const header = wrapper.get('[data-test="page-header"]');
    const inviteButtons = wrapper.findAll('[data-testid="invite-user-button"]');

    expect(inviteButtons).toHaveLength(1);
    expect(header.get('[data-testid="invite-user-button"]').text()).toBe("ユーザーを招待");
    expect(wrapper.find(".users-invite-section__actions").exists()).toBe(false);

    await header.get('[data-testid="invite-user-button"]').trigger("click");
    await flushPromises();

    expect(wrapper.find("#invite-email").exists()).toBe(true);
    expect(wrapper.text()).toContain("招待トークン発行");
  });

  it("keeps invitations usable when user and role management are forbidden", async () => {
    authorizedFetchMock.mockImplementation(async (_store, input) => {
      const path = String(input);
      if (path === "/api/admin/users" || path === "/api/admin/roles") return createResponse({}, 403);
      if (path === "/api/admin/auth/invites/role-options")
        return createResponse({ items: [{ id: "custom", name: "Writer", description: null, isSystem: false }] });
      if (path === "/api/admin/auth/invites") return createResponse({ items: [] });
      return createResponse({}, 404);
    });
    const wrapper = mountUsersPage();
    await flushPromises();
    expect(wrapper.text()).toContain("ユーザー一覧を表示する権限がありません");
    expect(wrapper.text()).not.toContain(ja.settings.users.error_fetch);
    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    await flushPromises();
    expect(wrapper.find("#invite-email").exists()).toBe(true);
    expect(authorizedFetchMock).toHaveBeenCalledWith(expect.anything(), "/api/admin/auth/invites/role-options");
  });

  it("omits the delete action for system users", async () => {
    mockUserList([createUserFixture(true)]);

    const wrapper = mountUsersPage();
    await flushPromises();

    expect(wrapper.find('[data-label="削除"]').exists()).toBe(false);
  });

  it("renders the delete action for deletable users", async () => {
    mockUserList([createUserFixture(false)]);

    const wrapper = mountUsersPage();
    await flushPromises();

    expect(wrapper.find('[data-label="削除"]').exists()).toBe(true);
  });
});
