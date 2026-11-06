import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { VueNodeViewRenderer, type NodeViewProps } from "@tiptap/vue-3";
import type { Component } from "vue";
import MediaReferenceNodeView from "./MediaReferenceNodeView.vue";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaReference: {
      setMediaReference: (attrs: { mediaId: string }) => ReturnType;
      updateMediaReference: (attrs: { mediaId: string }) => ReturnType;
      unsetMediaReference: () => ReturnType;
    };
  }
}

export const MediaReference = Node.create({
  name: "mediaReference",

  inline: false,

  group: "block",

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      mediaId: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-media-id") || "",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.mediaId) return {};
          return { "data-media-id": attributes.mediaId };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "media-reference[data-media-id]" }, { tag: "div[data-media-reference]" }, { tag: "span[data-media-reference]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "media-reference",
      mergeAttributes(HTMLAttributes, {
        "data-media-reference": "",
      }),
    ];
  },

  addCommands() {
    return {
      setMediaReference:
        (attrs) =>
        ({ chain }) => {
          if (!attrs?.mediaId) return false;
          return chain()
            .focus()
            .insertContent({ type: this.name, attrs: { mediaId: attrs.mediaId } })
            .run();
        },
      updateMediaReference:
        (attrs) =>
        ({ chain }) => {
          if (!attrs?.mediaId) return false;
          return chain().focus().updateAttributes(this.name, { mediaId: attrs.mediaId }).run();
        },
      unsetMediaReference:
        () =>
        ({ state, dispatch }) => {
          const { selection } = state;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
          if (dispatch) {
            const tr = state.tr.delete(selection.from, selection.to);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(MediaReferenceNodeView as unknown as Component<NodeViewProps>);
  },
});

export default MediaReference;
