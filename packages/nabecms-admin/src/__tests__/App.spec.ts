import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import App from "../App.vue";

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/" }),
}));

describe("App", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it("mounts without errors and renders main layout", () => {
    const wrapper = mount(App, {
      global: {
        // stub router-view and sidebar for isolation
        stubs: { "router-view": true, AppSidebar: true, Toast: true },
        plugins: [pinia, createI18n({ legacy: false, locale: "en", messages: { en: {} } })],
      },
    });
    // main content container should exist
    expect(wrapper.find("main.main-content").exists()).toBe(true);
  });
});
