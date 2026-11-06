import { mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, type PropType } from "vue";
import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import MarkdownEditorField from "../MarkdownEditorField.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en },
});

const CodeMirrorInputStub = defineComponent({
  name: "CodeMirrorInput",
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    modelValue: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    placeholder: { type: String, default: "" },
    height: { type: [Number, String], default: undefined },
    minHeight: { type: [Number, String], default: undefined },
    maxHeight: { type: [Number, String], default: undefined },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h("textarea", {
        ...attrs,
        id: props.id,
        value: props.modelValue,
        disabled: props.disabled,
        placeholder: props.placeholder,
        "data-test": "markdown-source",
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLTextAreaElement).value),
      });
  },
});

const SelectButtonStub = defineComponent({
  name: "SelectButton",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    options: { type: Array as PropType<Array<{ label: string; value: string }>>, default: () => [] },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h(
        "div",
        attrs,
        props.options.map((option) =>
          h(
            "button",
            {
              type: "button",
              disabled: props.disabled,
              "data-mode": option.value,
              "aria-pressed": props.modelValue === option.value ? "true" : "false",
              onClick: () => emit("update:modelValue", option.value),
            },
            option.label,
          ),
        ),
      );
  },
});

const ToggleSwitchStub = defineComponent({
  name: "ToggleSwitch",
  inheritAttrs: false,
  props: {
    id: { type: String, default: undefined },
    modelValue: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h("input", {
        ...attrs,
        id: props.id,
        type: "checkbox",
        checked: props.modelValue,
        disabled: props.disabled,
        onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).checked),
      });
  },
});

const ButtonStub = defineComponent({
  name: "NabeButtonStub",
  inheritAttrs: false,
  props: {
    label: { type: String, default: "" },
  },
  emits: ["click"],
  setup(props, { emit, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: String(attrs.type ?? "button"),
          onClick: (event: MouseEvent) => emit("click", event),
        },
        props.label,
      );
  },
});

/** Mount the Markdown editor with lightweight UI stubs. */
const mountMarkdownEditor = (modelValue: string): VueWrapper =>
  mount(MarkdownEditorField, {
    props: {
      id: "body",
      modelValue,
    },
    global: {
      plugins: [i18n],
      stubs: {
        Button: ButtonStub,
        CodeMirrorInput: CodeMirrorInputStub,
        SelectButton: SelectButtonStub,
        ToggleSwitch: ToggleSwitchStub,
      },
    },
  });

/** Read the isolated preview document written to iframe[srcdoc]. */
const previewSrcdoc = (wrapper: VueWrapper): string => wrapper.get<HTMLIFrameElement>('[data-test="markdown-preview-frame"]').attributes("srcdoc") ?? "";

/** Read the sandbox attribute on the isolated preview frame. */
const previewSandbox = (wrapper: VueWrapper): string => wrapper.get<HTMLIFrameElement>('[data-test="markdown-preview-frame"]').attributes("sandbox") ?? "";

/** Toggle a preview control by its data-test marker. */
const setToggle = async (wrapper: VueWrapper, testId: string, enabled: boolean): Promise<void> => {
  await wrapper.get<HTMLInputElement>(`[data-test="${testId}"]`).setValue(enabled);
};

describe("MarkdownEditorField", () => {
  it("renders regular Markdown into the isolated preview frame", () => {
    const wrapper = mountMarkdownEditor("# Hello");

    expect(previewSrcdoc(wrapper)).toContain("<h1>Hello</h1>");
    expect(previewSandbox(wrapper)).not.toContain("allow-scripts");
  });

  it("renders preview controls in the preview header", () => {
    const wrapper = mountMarkdownEditor("# Hello");
    const previewHeader = wrapper.get(".markdown-editor-field__preview-header");

    expect(previewHeader.get('[role="group"][aria-label="Markdown preview controls"]').exists()).toBe(true);
  });

  it("escapes raw HTML when HTML preview is disabled", () => {
    const wrapper = mountMarkdownEditor("<span>raw</span>");

    expect(previewSrcdoc(wrapper)).toContain("&lt;span&gt;raw&lt;/span&gt;");
    expect(previewSrcdoc(wrapper)).not.toContain("<span>raw</span>");
  });

  it("allows raw HTML preview but sanitizes scripts and event handlers", async () => {
    const wrapper = mountMarkdownEditor('<img src="x" onerror="alert(1)"><script>alert(1)</script>');

    await setToggle(wrapper, "markdown-toggle-html", true);

    expect(previewSrcdoc(wrapper)).toContain("<img");
    expect(previewSrcdoc(wrapper)).not.toContain("onerror");
    expect(previewSrcdoc(wrapper)).not.toContain("<script");
  });

  it("keeps iframes removed by default and allows only HTTP(S) iframe sources when enabled", async () => {
    const wrapper = mountMarkdownEditor('<iframe src="https://example.com/embed" srcdoc="<p>x</p>"></iframe><iframe src="javascript:alert(1)"></iframe>');

    await setToggle(wrapper, "markdown-toggle-html", true);

    expect(previewSrcdoc(wrapper)).not.toContain("<iframe");

    await setToggle(wrapper, "markdown-toggle-iframe", true);

    expect(previewSrcdoc(wrapper)).toContain("<iframe");
    expect(previewSrcdoc(wrapper)).toContain('src="https://example.com/embed"');
    expect(previewSrcdoc(wrapper)).toContain('sandbox=""');
    expect(previewSrcdoc(wrapper)).toContain('referrerpolicy="no-referrer"');
    expect(previewSrcdoc(wrapper)).toContain('loading="lazy"');
    expect(previewSrcdoc(wrapper)).not.toContain("srcdoc");
    expect(previewSrcdoc(wrapper)).not.toContain("javascript:");
  });

  it("requires confirmation before enabling script preview and isolates it with allow-scripts only", async () => {
    const wrapper = mountMarkdownEditor("<script>window.__markdownPreview = true</script><p>ok</p>");

    await setToggle(wrapper, "markdown-toggle-html", true);
    await setToggle(wrapper, "markdown-toggle-script", true);

    expect(wrapper.get('[data-test="markdown-script-warning"]').exists()).toBe(true);
    expect(previewSandbox(wrapper)).not.toContain("allow-scripts");
    expect(previewSrcdoc(wrapper)).not.toContain("<script");

    await wrapper.get('[data-test="markdown-confirm-script"]').trigger("click");

    expect(previewSandbox(wrapper)).toBe("allow-scripts");
    expect(previewSandbox(wrapper)).not.toContain("allow-same-origin");
    expect(previewSrcdoc(wrapper)).toContain("<script>window.__markdownPreview = true</script>");
  });
});
