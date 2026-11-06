import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { VueNodeViewRenderer, type NodeViewProps } from "@tiptap/vue-3";
import type { Component } from "vue";
import EntryReferenceNodeView from "./EntryReferenceNodeView.vue";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    entryReference: {
      setEntryReference: (attrs: { entryId: string }) => ReturnType;
      updateEntryReference: (attrs: { entryId: string }) => ReturnType;
      unsetEntryReference: () => ReturnType;
    };
  }
}

export const EntryReference = Node.create({
  name: "entryReference",

  inline: false,

  group: "block",

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      entryId: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-entry-id") || "",
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.entryId) {
            return {};
          }
          return {
            "data-entry-id": attributes.entryId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "entry-reference[data-entry-id]",
      },
      {
        tag: "div[data-entry-reference]",
      },
      {
        tag: "span[data-entry-reference]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "entry-reference",
      mergeAttributes(HTMLAttributes, {
        "data-entry-reference": "",
      }),
    ];
  },

  addCommands() {
    return {
      setEntryReference:
        (attrs) =>
        ({ chain }) => {
          if (!attrs?.entryId) {
            return false;
          }
          return chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { entryId: attrs.entryId },
            })
            .run();
        },
      updateEntryReference:
        (attrs) =>
        ({ chain }) => {
          if (!attrs?.entryId) {
            return false;
          }
          return chain()
            .focus()
            .updateAttributes(this.name, {
              entryId: attrs.entryId,
            })
            .run();
        },
      unsetEntryReference:
        () =>
        ({ state, dispatch }) => {
          const { selection } = state;
          if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) {
            return false;
          }
          if (dispatch) {
            const tr = state.tr.delete(selection.from, selection.to);
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(EntryReferenceNodeView as unknown as Component<NodeViewProps>);
  },
});

export default EntryReference;
