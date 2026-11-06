/* eslint-disable vue/multi-word-component-names */
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, h } from "vue";
import en from "../../locales/en.json";
import { useUiStore } from "../../stores/ui";
import AppSidebar from "../AppSidebar.vue";

const DrawerStub = defineComponent({
  name: "Drawer",
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    id: {
      type: String,
      default: undefined,
    },
  },
  emits: ["update:visible"],
  setup(props, { attrs, emit, slots }) {
    const closeCallback = () => {
      emit("update:visible", false);
    };

    return () =>
      h(
        "div",
        {
          ...attrs,
          id: props.id,
          class: "drawer-stub",
          "data-visible": String(props.visible),
        },
        props.visible ? (slots.container?.({ closeCallback }) ?? slots.default?.()) : undefined,
      );
  },
});

const PopoverStub = defineComponent({
  name: "Popover",
  props: {
    width: {
      type: Number,
      default: undefined,
    },
  },
  setup(props, { slots, expose }) {
    expose({
      hide: vi.fn(),
      toggle: vi.fn(),
    });
    return () => h("div", { class: "popover-stub", "data-width": props.width }, slots.default?.());
  },
});

const LanguageSwitcherDialogStub = defineComponent({
  name: "LanguageSwitcherDialog",
  setup(_, { slots, expose }) {
    expose({
      openDialog: vi.fn(),
    });
    return () => h("div", { class: "language-switcher-dialog-stub" }, slots.trigger?.());
  },
});

const AvatarStub = defineComponent({
  name: "Avatar",
  render() {
    return h("div", { class: "avatar-stub" }, "A");
  },
});

/**
 * Create a router that mirrors the sidebar navigation routes.
 */
const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory("/admin/"),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/models", component: { template: "<div />" } },
      { path: "/contents", component: { template: "<div />" } },
      { path: "/media", component: { template: "<div />" } },
      { path: "/logs", component: { template: "<div />" } },
      { path: "/settings", component: { template: "<div />" } },
      { path: "/settings/users", component: { template: "<div />" } },
      { path: "/settings/roles", component: { template: "<div />" } },
      { path: "/settings/locales", component: { template: "<div />" } },
      { path: "/settings/api-keys", component: { template: "<div />" } },
      { path: "/auth/logout", component: { template: "<div />" } },
    ],
  });

type MountSidebarOptions = {
  collapsed?: boolean;
  mobile?: boolean;
  path?: string;
};

/**
 * Install a deterministic matchMedia mock for the requested viewport size.
 */
const installMatchMediaMock = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
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
 * Mount the sidebar with router, i18n, and pinia configured for interaction tests.
 */
const mountSidebar = async ({ path = "/", collapsed = false, mobile = false }: MountSidebarOptions = {}) => {
  installMatchMediaMock(mobile);

  const pinia = createPinia();
  setActivePinia(pinia);

  const ui = useUiStore(pinia);
  ui.setSidebar(collapsed);

  const router = createTestRouter();
  await router.push(path);
  await router.isReady();

  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en },
  });

  const wrapper = mount(AppSidebar, {
    global: {
      directives: {
        tooltip: {
          mounted: () => undefined,
          updated: () => undefined,
        },
      },
      plugins: [pinia, router, i18n],
      stubs: {
        Avatar: AvatarStub,
        Drawer: DrawerStub,
        LanguageSwitcherDialog: LanguageSwitcherDialogStub,
        Popover: PopoverStub,
      },
    },
  });

  await flushPromises();

  return { router, ui, wrapper };
};

beforeEach(() => {
  localStorage.clear();
});

describe("AppSidebar", () => {
  it("renders navigation items as links and keeps submenu disclosure separate", async () => {
    const { wrapper } = await mountSidebar({ path: "/settings/users" });

    const topLevelLinks = wrapper.findAll(".menu-item > .menu-entry > a.menu-link");
    expect(topLevelLinks).toHaveLength(6);
    expect(wrapper.find("div.menu-link").exists()).toBe(false);
    expect(wrapper.find("div.submenu-link").exists()).toBe(false);

    const settingsLink = topLevelLinks.at(-1);
    expect(settingsLink?.attributes("href")).toBe("/admin/settings");
    expect(settingsLink?.attributes("aria-current")).toBeUndefined();

    const disclosure = wrapper.get("button.menu-disclosure");
    expect(disclosure.attributes("aria-controls")).toBe("sidebar-submenu-settings");
    expect(disclosure.attributes("aria-expanded")).toBe("true");

    const currentChild = wrapper.get("a.submenu-link[aria-current='page']");
    expect(currentChild.text()).toContain("Users");
    expect(wrapper.text()).not.toContain("Integrations");
    expect(wrapper.text()).not.toContain("Hooks");
  });

  it("navigates to the settings overview from the section link", async () => {
    const { router, wrapper } = await mountSidebar();

    const settingsLink = wrapper.findAll(".menu-item > .menu-entry > a.menu-link").at(-1);
    expect(settingsLink).toBeDefined();

    await settingsLink?.trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/settings");
  });

  it("marks only the exact settings child page as active", async () => {
    const { wrapper } = await mountSidebar({ path: "/settings/locales" });

    const activeChildLinks = wrapper.findAll("a.submenu-link--active");
    expect(activeChildLinks).toHaveLength(1);
    expect(activeChildLinks[0].text()).toContain("Locales");
    expect(activeChildLinks[0].attributes("aria-current")).toBe("page");

    const generalSettingsLink = wrapper.findAll("a.submenu-link").find((link) => link.text().includes("General"));
    expect(generalSettingsLink).toBeDefined();
    expect(generalSettingsLink?.classes()).not.toContain("submenu-link--active");
    expect(generalSettingsLink?.attributes("aria-current")).toBeUndefined();
  });

  it("toggles the settings submenu from the disclosure button", async () => {
    const { wrapper } = await mountSidebar();

    const disclosure = wrapper.get("button.menu-disclosure");
    expect(wrapper.find("#sidebar-submenu-settings").exists()).toBe(true);

    await disclosure.trigger("click");
    expect(disclosure.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find("#sidebar-submenu-settings").exists()).toBe(false);

    await disclosure.trigger("click");
    expect(disclosure.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find("#sidebar-submenu-settings").exists()).toBe(true);
  });

  it("keeps collapsed navigation labelled for assistive technologies", async () => {
    const { wrapper } = await mountSidebar({ collapsed: true, path: "/settings" });

    const settingsLink = wrapper.findAll("a.menu-link").at(-1);
    expect(settingsLink?.attributes("aria-label")).toBe("Settings");
    expect(settingsLink?.attributes("aria-current")).toBe("page");
    expect(wrapper.find("button.menu-disclosure").exists()).toBe(false);
    expect(wrapper.find(".submenu-list").exists()).toBe(false);
    expect(wrapper.get("nav.sidebar-nav").attributes("aria-label")).toBe("Main navigation");
    expect(wrapper.get("button.user-trigger").attributes("aria-label")).toBe("User menu");
  });

  it("reveals expanded content only after the sidebar width transition completes", async () => {
    const { wrapper } = await mountSidebar({ collapsed: true });
    const sidebar = wrapper.get("aside.sidebar");
    const toggle = wrapper.get("button.sidebar-collapse-toggle");

    expect(wrapper.find(".menu-label").exists()).toBe(false);

    await toggle.trigger("click");

    expect(sidebar.classes()).not.toContain("sidebar--collapsed");
    expect(wrapper.find(".menu-label").exists()).toBe(false);

    await sidebar.trigger("transitionend", { propertyName: "width" });

    expect(wrapper.find(".menu-label").exists()).toBe(true);

    await toggle.trigger("click");

    expect(sidebar.classes()).toContain("sidebar--collapsed");
    expect(wrapper.find(".menu-label").exists()).toBe(false);
  });

  it("renders a mobile trigger and opens the drawer instead of a fixed aside", async () => {
    const { wrapper } = await mountSidebar({ mobile: true });

    expect(wrapper.find("aside.sidebar").exists()).toBe(false);
    expect(wrapper.get(".sidebar-mobile-bar").exists()).toBe(true);
    expect(wrapper.get(".drawer-stub").attributes("style")).toContain("width: min(var(--sidebar-width), calc(100vw - var(--mobile-sidebar-gap)))");
    expect(wrapper.get("button.mobile-sidebar-toggle").attributes("aria-expanded")).toBe("false");
    expect(wrapper.get("button.mobile-sidebar-toggle").attributes("aria-label")).toBe("Open navigation menu");
    expect(wrapper.find(".mobile-sidebar-toggle__text").exists()).toBe(false);
    expect(wrapper.get(".drawer-stub").attributes("data-visible")).toBe("false");

    await wrapper.get("button.mobile-sidebar-toggle").trigger("click");
    await flushPromises();

    expect(wrapper.get("button.mobile-sidebar-toggle").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".drawer-stub").attributes("data-visible")).toBe("true");
    expect(wrapper.find(".sidebar.sidebar--mobile").exists()).toBe(true);
    expect(wrapper.find(".sidebar.sidebar--mobile .sidebar-collapse-toggle").exists()).toBe(false);
    expect(wrapper.find(".sidebar.sidebar--mobile .sidebar-mobile-close").exists()).toBe(false);
  });

  it("closes the mobile drawer after navigation", async () => {
    const { router, ui, wrapper } = await mountSidebar({ mobile: true });

    await wrapper.get("button.mobile-sidebar-toggle").trigger("click");
    await flushPromises();
    expect(ui.mobileSidebarOpen).toBe(true);

    const modelsLink = wrapper.findAll("a.menu-link").at(1);
    expect(modelsLink).toBeDefined();

    await modelsLink?.trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/models");
    expect(ui.mobileSidebarOpen).toBe(false);
    expect(wrapper.get(".drawer-stub").attributes("data-visible")).toBe("false");
  });
});
