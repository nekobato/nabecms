import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, inject, provide, ref } from "vue";
import ElementPlus from "element-plus";
import UsersInviteSection from "../UsersInviteSection.vue";
import type { InviteItem, RoleItem } from "@/pages/settings/users-shared";

const toastAddMock = vi.fn();
const authorizedFetchMock = vi.fn();

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: ref("en"),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    accessToken: "token",
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/utils/http", () => ({
  authorizedFetch: (...args: unknown[]) => authorizedFetchMock(...args),
}));

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  emits: ["click"],
  setup(_props, { emit, slots, attrs }) {
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
    visible: { type: Boolean, default: false },
  },
  emits: ["update:visible", "hide"],
  setup(props, { slots }) {
    return () => (props.visible ? h("div", { "data-stub": "Dialog" }, [slots.default?.(), slots.footer?.()]) : null);
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
  setup(props, { emit, attrs }) {
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
    options: { type: Array, default: () => [] },
    optionLabel: { type: String, default: "label" },
    optionValue: { type: String, default: "value" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () =>
      h(
        "div",
        { "data-stub": "Select" },
        (props.options as Record<string, string>[]).map((option) =>
          h(
            "button",
            {
              type: "button",
              "data-role": option[props.optionValue],
              onClick: () => emit("update:modelValue", option[props.optionValue]),
            },
            option[props.optionLabel],
          ),
        ),
      );
  },
});

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("div", [...(slots.title?.() ?? []), ...(slots.content?.() ?? [])]);
  },
});

const tableRowsKey = Symbol("invite-table-rows");

const ElTableStub = defineComponent({
  name: "ElTableStub",
  props: { data: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    provide(tableRowsKey, () => props.data);
    return () => h("div", { "data-stub": "ElTable" }, slots.default?.());
  },
});

const ElTableColumnStub = defineComponent({
  name: "ElTableColumnStub",
  setup(_props, { slots }) {
    const rows = inject<() => unknown[]>(tableRowsKey, () => []);
    return () =>
      h(
        "div",
        rows().flatMap((row) => slots.default?.({ row }) ?? []),
      );
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

const createResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    return body;
  },
});

/**
 * Install browser breakpoint support expected by responsive dialogs.
 */
const installMatchMediaMock = () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

/**
 * Mount the invite section with lightweight stubs for behavior-focused tests.
 */
const mountComponent = (roles: RoleItem[] = [{ id: "role_admin", name: "Admin", description: null, isSystem: false }]) =>
  mount(UsersInviteSection, {
    props: {
      roles,
    },
    global: {
      stubs: {
        Button: ButtonStub,
        Card: CardStub,
        ElTable: ElTableStub,
        ElTableColumn: ElTableColumnStub,
        Dialog: DialogStub,
        InputText: InputTextStub,
        NabeButton: ButtonStub,
        Select: SelectStub,
        Tag: TagStub,
      },
    },
  });

/**
 * Mount the invite section with the real Element Plus Dialog and Select while
 * keeping unrelated child components lightweight.
 */
const mountComponentWithElementDialog = () =>
  mount(UsersInviteSection, {
    attachTo: document.body,
    props: {
      roles: [{ id: "role_admin", name: "Admin", description: null, isSystem: false }],
    },
    global: {
      plugins: [ElementPlus],
      stubs: {
        Button: ButtonStub,
        Card: CardStub,
        ElTable: ElTableStub,
        ElTableColumn: ElTableColumnStub,
        InputText: InputTextStub,
        Tag: TagStub,
      },
    },
  });

describe("UsersInviteSection", () => {
  beforeEach(() => {
    installMatchMediaMock();
    authorizedFetchMock.mockReset();
    toastAddMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fetches invites on mount", async () => {
    authorizedFetchMock.mockResolvedValueOnce(createResponse({ items: [] }));

    mountComponent();
    await flushPromises();

    expect(authorizedFetchMock).toHaveBeenCalledWith(expect.anything(), "/api/admin/auth/invites");
  });

  it("shows role names on initial load and remount without opening the invite dialog", async () => {
    const invite: InviteItem = {
      id: "invite_existing",
      email: "invitee@example.com",
      roleIds: ["role_writer"],
      status: "sent",
      expiresAt: "2099-03-10T00:00:00Z",
      sentAt: "2026-03-01T00:00:00Z",
      createdAt: "2026-03-01T00:00:00Z",
      createdBy: "user_inviter",
    };
    authorizedFetchMock.mockImplementation((_auth, url: string) =>
      Promise.resolve(
        createResponse({
          items: url.endsWith("/role-options") ? [{ id: "role_writer", name: "Writer", description: null, isSystem: false }] : [invite],
        }),
      ),
    );

    for (let load = 0; load < 2; load += 1) {
      const wrapper = mountComponent([]);
      await flushPromises();

      expect(wrapper.get(".roles-inline").text()).toBe("Writer");
      expect(wrapper.find("#invite-email").exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it.each(["http", "network"])("keeps invites visible after a %s role lookup failure and retries when opening the dialog", async (failure) => {
    let roleRequests = 0;
    authorizedFetchMock.mockImplementation((_auth, url: string) => {
      if (url.endsWith("/role-options")) {
        roleRequests += 1;
        if (roleRequests === 1) {
          return failure === "network" ? Promise.reject(new Error("Offline")) : Promise.resolve(createResponse({}, 503));
        }
        return Promise.resolve(createResponse({ items: [{ id: "role_writer", name: "Writer", description: null, isSystem: false }] }));
      }
      return Promise.resolve(
        createResponse({
          items: [
            {
              id: "invite_existing",
              email: "invitee@example.com",
              roleIds: ["role_writer"],
              status: "sent",
              expiresAt: "2099-03-10T00:00:00Z",
            },
          ],
        }),
      );
    });
    const wrapper = mountComponent([]);
    await flushPromises();

    expect(wrapper.get(".roles-inline").text()).toBe("role_writer");
    expect(wrapper.text()).toContain("invitee@example.com");

    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    await flushPromises();

    expect(wrapper.get(".roles-inline").text()).toBe("Writer");
    expect(wrapper.find('button[data-role="role_writer"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("opens the invite form from the user invite action", async () => {
    authorizedFetchMock.mockResolvedValueOnce(createResponse({ items: [] }));

    const wrapper = mountComponent();
    await flushPromises();

    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");

    expect(wrapper.find("#invite-email").exists()).toBe(true);
    expect(wrapper.html()).toContain("settings.invites.description");
  });
  it("excludes Super Admin and system roles while preserving user-defined roles", async () => {
    authorizedFetchMock.mockResolvedValueOnce(createResponse({ items: [] }));
    const wrapper = mountComponent();
    await wrapper.setProps({
      roles: [
        { id: "system.super-admin", name: "Super Admin", description: null, isSystem: false },
        { id: "reserved", name: "Reserved", description: null, isSystem: true },
        { id: "system.editor.custom", name: "Custom editor", description: null, isSystem: false },
        { id: "role_admin", name: "Admin", description: null, isSystem: false },
      ],
    });
    await flushPromises();
    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    expect(wrapper.find('button[data-role="system.super-admin"]').exists()).toBe(false);
    expect(wrapper.find('button[data-role="reserved"]').exists()).toBe(false);
    expect(wrapper.find('button[data-role="role_admin"]').exists()).toBe(true);
    expect(wrapper.find('button[data-role="system.editor.custom"]').exists()).toBe(true);
  });
  it("loads invitation role choices without role management access", async () => {
    authorizedFetchMock
      .mockResolvedValueOnce(createResponse({ items: [] }))
      .mockResolvedValueOnce(createResponse({ items: [{ id: "custom", name: "Writer", description: null, isSystem: false }] }));
    const wrapper = mountComponent();
    await wrapper.setProps({ roles: [] });
    await flushPromises();
    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    await flushPromises();
    expect(authorizedFetchMock).toHaveBeenCalledWith(expect.anything(), "/api/admin/auth/invites/role-options");
    expect(wrapper.find('button[data-role="custom"]').exists()).toBe(true);
  });

  it("renders the Element Plus invite dialog when the action is clicked", { timeout: 10_000 }, async () => {
    authorizedFetchMock.mockResolvedValueOnce(createResponse({ items: [] }));

    const wrapper = mountComponentWithElementDialog();
    await flushPromises();

    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    await flushPromises();

    expect(document.body.querySelector(".el-dialog.invite-dialog")).not.toBeNull();
    expect(document.body.querySelector(".el-select")).not.toBeNull();
    expect(document.body.textContent).toContain("settings.invites.description");
  });

  it("creates an invite token and refreshes the list", async () => {
    authorizedFetchMock
      .mockResolvedValueOnce(createResponse({ items: [] }))
      .mockResolvedValueOnce(createResponse({ inviteId: "inv_1", token: "token-123", expiresAt: "2026-03-10T00:00:00Z" }))
      .mockResolvedValueOnce(createResponse({ items: [] }));

    const wrapper = mountComponent();
    await flushPromises();

    await wrapper.get('[data-testid="invite-user-button"]').trigger("click");
    await wrapper.get("#invite-email").setValue("test@example.com");
    await wrapper.get('button[data-role="role_admin"]').trigger("click");

    expect(wrapper.text()).not.toContain("settings.invites.hint_once");

    const generateButtons = wrapper.findAll('button[data-label="settings.invites.generate"]');
    await generateButtons.at(0)!.trigger("click");
    await flushPromises();

    expect(authorizedFetchMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "/api/admin/auth/invites",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(JSON.parse(String(authorizedFetchMock.mock.calls[1]?.[2]?.body))).toEqual(
      expect.objectContaining({
        roleIds: ["role_admin"],
      }),
    );
    expect(wrapper.html()).toContain("token-123");
    expect(wrapper.text()).toContain("settings.invites.hint_once");
    expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ detail: "settings.invites.toast_created" }));
  });
});
