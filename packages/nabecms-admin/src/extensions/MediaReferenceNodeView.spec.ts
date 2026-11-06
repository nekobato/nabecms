import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MediaReferenceNodeView from "./MediaReferenceNodeView.vue";

type MediaReferenceNodeViewProps = InstanceType<typeof MediaReferenceNodeView>["$props"];

const getCachedMediaReferenceMock = vi.fn();
const loadMediaReferenceMock = vi.fn();

vi.mock("@/services/mediaReferences", () => ({
  getCachedMediaReference: (...args: unknown[]) => getCachedMediaReferenceMock(...args),
  loadMediaReference: (...args: unknown[]) => loadMediaReferenceMock(...args),
}));

const NodeViewWrapperStub = defineComponent({
  name: "NodeViewWrapper",
  inheritAttrs: false,
  props: {
    as: { type: String, default: "div" },
  },
  setup(props, { attrs, slots }) {
    return () => h(props.as, attrs, slots.default?.());
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  props: {
    visible: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => (props.visible ? h("div", { "data-stub": "Dialog" }, slots.default?.()) : null);
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h("button", { ...attrs, type: "button" }, slots.default?.() ?? (typeof attrs.label === "string" ? attrs.label : ""));
  },
});

const IconStub = defineComponent({
  name: "NabeIcon",
  inheritAttrs: false,
  setup(_, { attrs }) {
    return () => h("span", { ...attrs, "data-stub": "NabeIcon" });
  },
});

const mountNodeView = () =>
  mount(MediaReferenceNodeView, {
    props: {
      node: { attrs: { mediaId: "media-1" } },
      editor: {},
      decorations: [],
      innerDecorations: {},
      view: {},
      selected: false,
      extension: {},
      getPos: () => 0,
      updateAttributes: vi.fn(),
      deleteNode: vi.fn(),
    } as unknown as MediaReferenceNodeViewProps,
    global: {
      stubs: {
        NodeViewWrapper: NodeViewWrapperStub,
        Dialog: DialogStub,
        Button: ButtonStub,
        NabeIcon: IconStub,
      },
    },
  });

describe("MediaReferenceNodeView", () => {
  beforeEach(() => {
    getCachedMediaReferenceMock.mockReset();
    loadMediaReferenceMock.mockReset();

    getCachedMediaReferenceMock.mockReturnValue({
      id: "media-1",
      url: "/api/admin/media/media-1/file",
      name: "Hero image.png",
      description: null,
      mimeType: "image/png",
      width: 1200,
      height: 800,
      size: 1024,
      status: "published",
      updatedAt: null,
    });
  });

  it("renders rich text media as a blog-style figure with the image first", async () => {
    const wrapper = mountNodeView();
    await flushPromises();

    const figure = wrapper.get("figure.media-reference-card");
    expect(figure.attributes("role")).toBe("button");

    const image = wrapper.get(".media-reference-frame img");
    expect(image.attributes("src")).toBe("/api/admin/media/media-1/file");
    expect(image.attributes("alt")).toBe("Hero image.png");
    expect(image.attributes("width")).toBe("1200");
    expect(image.attributes("height")).toBe("800");

    const caption = wrapper.get(".media-reference-caption");
    expect(caption.text()).toContain("Hero image.png");
    expect(caption.text()).toContain("image/png");
    expect(caption.text()).toContain("#media-1");
  });
});
