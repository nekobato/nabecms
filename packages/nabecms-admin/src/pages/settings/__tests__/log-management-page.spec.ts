import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { ElInputNumber, ElSwitch } from "element-plus";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ja from "@/locales/ja.json";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import type { ConfirmPayload } from "@/services/feedback";
import LogManagementPage from "../LogManagementPage.vue";

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@/utils/http", () => ({ authorizedFetch: vi.fn() }));
vi.mock("@/services/feedback", () => ({ useConfirm: () => ({ require: confirm }) }));
let payload = { item: { retentionDays: 90 as number | false }, cleanup: null, health: "never" };
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  payload = { item: { retentionDays: 90 }, cleanup: null, health: "never" };
  vi.mocked(authorizedFetch).mockImplementation(async (_auth, _url, init) => {
    if (init?.method === "PUT") payload.item = JSON.parse(String(init.body));
    return new Response(JSON.stringify(payload), { status: 200 });
  });
});
afterEach(() => {
  wrapper?.unmount();
});

async function render(roles = ["system.super-admin"]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = { id: "admin", email: "admin@example.test", name: "Admin", roleId: roles };
  wrapper = mount(LogManagementPage, {
    global: { plugins: [pinia, createI18n({ legacy: false, locale: "ja", messages: { ja } })], stubs: { PageSectionHeader: true } },
  });
  await flushPromises();
  return wrapper;
}

it("shows defaults and an unconfirmed first run", async () => {
  const page = await render();
  expect(page.getComponent(ElInputNumber).props("modelValue")).toBe(90);
  expect(page.text()).toContain("まだ実行を確認できていません");
});

it("does not load or expose settings for other roles", async () => {
  const page = await render(["editor"]);
  expect(page.text()).toContain("Super Adminのみ");
  expect(authorizedFetch).not.toHaveBeenCalled();
  expect(page.find("form").exists()).toBe(false);
});

it("saves indefinite retention and shows success", async () => {
  const page = await render();
  page.getComponent(ElSwitch).vm.$emit("update:modelValue", true);
  await flushPromises();
  await page.get("form").trigger("submit");
  await flushPromises();
  expect(authorizedFetch).toHaveBeenCalledWith(
    expect.anything(),
    "/api/admin/settings/logs",
    expect.objectContaining({ method: "PUT", body: '{"retentionDays":false}' }),
  );
  expect(page.text()).toContain("設定を保存しました");
  expect(page.findComponent(ElInputNumber).exists()).toBe(false);
});

it("waits for explicit confirmation before shortening and preserves cancelled input", async () => {
  const page = await render();
  page.getComponent(ElInputNumber).vm.$emit("update:modelValue", 30);
  await flushPromises();
  await page.get("form").trigger("submit");
  expect(confirm).toHaveBeenCalledOnce();
  expect(authorizedFetch).toHaveBeenCalledTimes(1);
  const dialog = confirm.mock.calls[0]?.[0] as ConfirmPayload;
  dialog.onHide?.();
  await flushPromises();
  expect(page.getComponent(ElInputNumber).props("modelValue")).toBe(30);
  await page.get("form").trigger("submit");
  await (confirm.mock.calls[1]?.[0] as ConfirmPayload).accept?.();
  expect(payload.item.retentionDays).toBe(30);
});

it("rejects fractional input and retains edits after a failed save", async () => {
  const page = await render();
  page.getComponent(ElInputNumber).vm.$emit("update:modelValue", 90.5);
  await flushPromises();
  await page.get("form").trigger("submit");
  await flushPromises();
  expect(page.text()).toContain("整数を入力してください");
  expect(authorizedFetch).toHaveBeenCalledTimes(1);
  page.getComponent(ElInputNumber).vm.$emit("update:modelValue", 180);
  await flushPromises();
  vi.mocked(authorizedFetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  await page.get("form").trigger("submit");
  await flushPromises();
  expect(page.text()).toContain("保存結果を確認できませんでした");
  expect(page.getComponent(ElInputNumber).props("modelValue")).toBe(180);
});

it("offers a retry instead of showing defaults as saved settings after a load failure", async () => {
  vi.mocked(authorizedFetch).mockResolvedValueOnce(new Response("", { status: 503 }));
  const page = await render();
  expect(page.get('[role="alert"]').text()).toContain("取得できませんでした");
  expect(page.find("form").exists()).toBe(false);
  await page.get("button").trigger("click");
  await flushPromises();
  expect(page.find("form").exists()).toBe(true);
});
