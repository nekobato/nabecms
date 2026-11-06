import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EntryReferenceNodeView from "./EntryReferenceNodeView.vue";
import { createReferenceSession, referenceSessionKey } from "@/pages/contents/entry-edit/referenceSession";

const { cached, load, push } = vi.hoisted(() => ({ cached: vi.fn(), load: vi.fn(), push: vi.fn() }));
vi.mock("@/services/entryReferences", () => ({ getCachedEntryReference: cached, loadEntryReference: load }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push, resolve: (path: string) => ({ href: path }) }) }));
const metadata = { entryId: "b", modelId: "model", modelName: "Authors", displayTitle: "Author B", status: "draft" };
const mountView = () => {
  const session = createReferenceSession({ modelId: "model", entryId: "a" });
  const wrapper = mount(EntryReferenceNodeView, {
    props: {
      node: { attrs: { entryId: "b" } },
      editor: {},
      decorations: [],
      innerDecorations: {},
      view: {},
      selected: false,
      extension: {},
      getPos: () => 0,
      updateAttributes: vi.fn(),
      deleteNode: vi.fn(),
    } as unknown as InstanceType<typeof EntryReferenceNodeView>["$props"],
    global: {
      provide: { [referenceSessionKey as symbol]: session },
      stubs: {
        NodeViewWrapper: defineComponent({
          setup:
            (_, { slots }) =>
            () =>
              h("div", slots.default?.()),
        }),
      },
    },
  });
  return { wrapper, session };
};
beforeEach(() => {
  vi.resetAllMocks();
});
describe("EntryReferenceNodeView", () => {
  it("opens the retained editor with the keyboard instead of leaving the page", async () => {
    cached.mockReturnValue(metadata);
    const { wrapper, session } = mountView();
    await wrapper.get('[role="button"]').trigger("keydown", { key: "Enter" });
    expect(session.current.value.entryId).toBe("b");
    expect(push).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("does not open a reference whose metadata cannot be loaded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    load.mockRejectedValue(new Error("not found"));
    const { wrapper, session } = mountView();
    await flushPromises();
    await wrapper.get('[role="button"]').trigger("click");
    expect(wrapper.get('[role="button"]').attributes("aria-disabled")).toBe("true");
    expect(session.panes).toHaveLength(1);
    wrapper.unmount();
    log.mockRestore();
  });
  it("ignores stale loading failures after the reference changes to a cached entry", async () => {
    let reject!: (error: Error) => void;
    load.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const { wrapper } = mountView();
    cached.mockReturnValue({ ...metadata, entryId: "c", displayTitle: "Organization C" });
    await wrapper.setProps({ node: { attrs: { entryId: "c" } } } as unknown as Partial<InstanceType<typeof EntryReferenceNodeView>["$props"]>);
    reject(new Error("old request failed"));
    await flushPromises();
    expect(wrapper.text()).toContain("Organization C");
    expect(wrapper.get('[role="button"]').attributes("aria-disabled")).toBe("false");
    wrapper.unmount();
  });
});
