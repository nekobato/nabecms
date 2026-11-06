import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import Workspace from "../entry-edit/EntryReferenceWorkspace.vue";
import EntryPage from "../EntryEditPage.vue";
import { useReferenceSession } from "../entry-edit/referenceSession";
import en from "@/locales/en.json";

const { beforeEach, unregister } = vi.hoisted(() => ({ beforeEach: vi.fn(), unregister: vi.fn() }));
vi.mock("vue-router", () => ({ useRouter: () => ({ beforeEach }) }));
vi.mock("../EntryEditor.vue", () => ({
  default: defineComponent({
    props: { modelId: { type: String, required: true }, entryId: { type: String, required: true } },
    setup(props) {
      const value = ref("");
      const session = useReferenceSession()!;
      return () =>
        h("section", { "data-entry": props.entryId }, [
          h("input", {
            value: value.value,
            onInput: (event: Event) => {
              value.value = (event.target as HTMLInputElement).value;
              session.update(props, { dirty: !!value.value });
            },
          }),
          ...["a", "b", "c"].map((entryId) =>
            h(
              "button",
              {
                "data-open": entryId,
                onClick: () => session.open({ modelId: "model", entryId, title: entryId }),
              },
              entryId,
            ),
          ),
        ]);
    },
  }),
}));
const Dialog = defineComponent({
  props: ["visible"],
  setup(props, { slots }) {
    return () => h("div", { "data-dialog": "", style: { display: props.visible ? "" : "none" } }, [slots.header?.(), slots.default?.(), slots.footer?.()]);
  },
});
const Popover = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h("div", [slots.reference?.(), slots.default?.()]),
});
const Button = defineComponent({ props: ["label"], setup: (props) => () => h("button", props.label) });
const createWrapper = () => {
  beforeEach.mockReturnValue(unregister);
  return mount(Workspace, {
    props: { modelId: "model", entryId: "a" },
    global: {
      plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })],
      stubs: { Dialog, ElPopover: Popover, Button },
    },
  });
};
afterEach(() => vi.restoreAllMocks());

describe("reference workspace", () => {
  it("recreates the workspace when distinct route IDs would share a raw slash key", async () => {
    beforeEach.mockReturnValue(unregister);
    const wrapper = mount(EntryPage, {
      props: { modelId: "victim", entryId: "a/b" },
      global: {
        plugins: [createI18n({ legacy: false, locale: "en", messages: { en } })],
        stubs: { Dialog, ElPopover: Popover, Button },
      },
    });
    try {
      await wrapper.get('[data-entry="a/b"] input').setValue("First entry draft");
      await wrapper.setProps({ modelId: "victim/a", entryId: "b" });
      expect(wrapper.find('[data-entry="a/b"]').exists()).toBe(false);
      expect((wrapper.get('[data-entry="b"] input').element as HTMLInputElement).value).toBe("");
    } finally {
      wrapper.unmount();
    }
  });
  it("preserves input when cycling to root and reopening an off-path entry", async () => {
    const wrapper = createWrapper();
    await wrapper.get('[data-entry="a"] input').setValue("root draft");
    await wrapper.get('[data-entry="a"] [data-open="b"]').trigger("click");
    await wrapper.get('[data-entry="b"] input').setValue("author draft");
    await wrapper.get('[data-entry="b"] [data-open="c"]').trigger("click");
    await wrapper.get('[data-entry="c"] input').setValue("organization draft");
    await wrapper.get('[data-entry="c"] [data-open="a"]').trigger("click");
    await wrapper.get('[data-entry="a"] [data-open="b"]').trigger("click");
    expect(wrapper.findAll('[data-entry="b"]')).toHaveLength(1);
    expect((wrapper.get('[data-entry="b"] input').element as HTMLInputElement).value).toBe("author draft");
    expect((wrapper.get('[data-entry="c"] input').element as HTMLInputElement).value).toBe("organization draft");
    expect(wrapper.text()).toContain("Unsaved changes 3");
    wrapper.unmount();
  });
  it("guards all drafts on route leave and reload, and unregisters on teardown", async () => {
    const wrapper = createWrapper();
    await wrapper.get('[data-entry="a"] [data-open="b"]').trigger("click");
    await wrapper.get('[data-entry="b"] input').setValue("retain me");
    await wrapper.get('[data-entry="b"] [data-open="a"]').trigger("click");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const guard = beforeEach.mock.calls.at(-1)![0];
    expect(guard()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("b"));
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    confirm.mockReturnValue(true);
    expect(guard()).toBe(true);
    wrapper.unmount();
    expect(unregister).toHaveBeenCalled();
  });
  it("cancels closing without losing related drafts; confirmed close retains root input", async () => {
    const wrapper = createWrapper();
    await wrapper.get('[data-entry="a"] input').setValue("root draft");
    await wrapper.get('[data-entry="a"] [data-open="b"]').trigger("click");
    await wrapper.get('[data-entry="b"] input').setValue("author draft");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const close = wrapper.findAll("button").find((button) => button.text() === "Close related entry editing")!;
    await close.trigger("click");
    expect(wrapper.find('[data-entry="b"]').exists()).toBe(true);
    confirm.mockReturnValue(true);
    await close.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-entry="b"]').exists()).toBe(false);
    expect((wrapper.get('[data-entry="a"] input').element as HTMLInputElement).value).toBe("root draft");
    wrapper.unmount();
  });
});
