import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import EmailSettingsPage from "../EmailSettingsPage.vue";
import en from "@/locales/en.json";
const state = vi.hoisted(() => ({ user: { roleId: ["system.super-admin"] }, fetch: vi.fn() }));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => state }));
vi.mock("@/utils/http", () => ({ authorizedFetch: (...args: unknown[]) => state.fetch(...args) }));
const Card = defineComponent({
  setup(_, { slots }) {
    return () => h("div", slots.content?.());
  },
});
function result(configured = true) {
  return {
    item: { senderName: "NabeCMS", invitesEnabled: false, passwordResetEnabled: false },
    environment: {
      configured,
      from: configured ? "no-reply@example.test" : null,
      baseUrl: "https://cms.example.test",
      missing: configured ? [] : ["EMAIL_SENDER"],
    },
    lastDelivery: null,
  };
}
function render() {
  return mount(EmailSettingsPage, { global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })], stubs: { Card } } });
}
beforeEach(() => {
  state.user.roleId = ["system.super-admin"];
  state.fetch.mockReset();
  state.fetch.mockResolvedValue({ ok: true, json: async () => result() });
});
describe("email settings", () => {
  it("shows environment as read-only and prevents tests with unsaved changes", async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("no-reply@example.test");
    expect(wrapper.findAll("input[type=text]")).toHaveLength(1);
    await wrapper.get("input[name=senderName]").setValue("Changed name");
    const test = wrapper.findAll("button").find((button) => button.text() === "Send test email")!;
    expect(test.attributes("disabled")).toBeDefined();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(state.fetch).toHaveBeenCalledWith(
      state,
      "/api/admin/settings/email",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ senderName: "Changed name", invitesEnabled: false, passwordResetEnabled: false }) }),
    );
    wrapper.unmount();
  });
  it("disables enabling features when the binding is missing", async () => {
    state.fetch.mockResolvedValue({ ok: true, json: async () => result(false) });
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain("EMAIL_SENDER");
    for (const checkbox of wrapper.findAll("input[type=checkbox]")) expect(checkbox.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });
  it("does not load settings for a non-super-admin", async () => {
    state.user.roleId = ["editor"];
    const wrapper = render();
    await flushPromises();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Only a super administrator");
    wrapper.unmount();
  });
  it("retains edited values after save failure", async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.get("input[name=senderName]").setValue("Keep this name");
    state.fetch.mockResolvedValue({ ok: false });
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect((wrapper.get("input[name=senderName]").element as HTMLInputElement).value).toBe("Keep this name");
    expect(wrapper.get("[role=alert]").text()).toContain("Could not save");
    wrapper.unmount();
  });
});
