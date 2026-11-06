<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { useI18n } from "vue-i18n";
import { SelectButton } from "@/components/ui/element-plus";
import { ToggleSwitch } from "@/components/ui/element-plus";

import CodeMirrorInput from "@/components/CodeMirrorInput.vue";
import Button from "@/components/NabeButton.vue";

type PreviewMode = "edit" | "split" | "preview";

type MarkdownEditorFieldProps = {
  id?: string;
  modelValue: string;
  disabled?: boolean;
  placeholder?: string;
};

const props = withDefaults(defineProps<MarkdownEditorFieldProps>(), {
  id: undefined,
  modelValue: "",
  disabled: false,
  placeholder: "",
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { t } = useI18n();

const safeMarkdownRenderer = new MarkdownIt({ html: false, linkify: true, typographer: false });
const htmlMarkdownRenderer = new MarkdownIt({ html: true, linkify: true, typographer: false });

const previewMode = ref<PreviewMode>("split");
const allowHtml = ref(false);
const allowIframe = ref(false);
const allowScript = ref(false);
const scriptConfirmationVisible = ref(false);
const fallbackId = useId();

const modeOptions = computed<Array<{ label: string; value: PreviewMode }>>(() => [
  { label: t("contents.markdown_editor.mode_edit"), value: "edit" },
  { label: t("contents.markdown_editor.mode_split"), value: "split" },
  { label: t("contents.markdown_editor.mode_preview"), value: "preview" },
]);

const markdownModel = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value),
});

const editorExtensions = computed<Extension[]>(() => [markdown(), EditorView.lineWrapping]);
const showEditor = computed(() => previewMode.value !== "preview");
const showPreview = computed(() => previewMode.value !== "edit");
const iframeDisabled = computed(() => !allowHtml.value || allowScript.value);
const scriptDisabled = computed(() => !allowHtml.value);
const previewSandbox = computed(() => (allowScript.value ? "allow-scripts" : ""));
const controlIdBase = computed(() => props.id ?? fallbackId);
const htmlToggleId = computed(() => `${controlIdBase.value}-markdown-html-preview`);
const iframeToggleId = computed(() => `${controlIdBase.value}-markdown-iframe-preview`);
const scriptToggleId = computed(() => `${controlIdBase.value}-markdown-script-preview`);

const renderedHtml = computed(() => {
  const renderer = allowHtml.value ? htmlMarkdownRenderer : safeMarkdownRenderer;
  return renderer.render(markdownModel.value);
});

const previewHtml = computed(() => {
  if (allowScript.value) return renderedHtml.value;
  const clean = DOMPurify.sanitize(renderedHtml.value, {
    ADD_TAGS: allowIframe.value ? ["iframe"] : [],
    ADD_ATTR: allowIframe.value ? ["allow", "allowfullscreen", "frameborder", "height", "loading", "referrerpolicy", "sandbox", "src", "title", "width"] : [],
  });
  return allowIframe.value ? normalizePreviewIframes(clean) : clean;
});

const previewDocument = computed(
  () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <base target="_blank">
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        padding: 16px;
        color: #1f2937;
        background: #ffffff;
        font: 14px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body > :first-child { margin-top: 0; }
      body > :last-child { margin-bottom: 0; }
      pre {
        overflow: auto;
        padding: 12px;
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #f9fafb;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        border: 1px solid #e5e7eb;
        padding: 6px 8px;
      }
      img,
      iframe {
        max-width: 100%;
      }
      blockquote {
        margin-left: 0;
        padding-left: 12px;
        border-left: 3px solid #d1d5db;
        color: #4b5563;
      }
    </style>
  </head>
  <body>${previewHtml.value || `<p class="empty">${escapeHtml(t("contents.markdown_editor.empty_preview"))}</p>`}</body>
</html>`,
);

watch(allowHtml, (enabled) => {
  if (enabled) return;
  allowIframe.value = false;
  allowScript.value = false;
  scriptConfirmationVisible.value = false;
});

watch(allowScript, (enabled) => {
  if (!enabled) return;
  allowIframe.value = false;
});

/** Escape static UI text before injecting it into the preview document. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Return true when an iframe src is an absolute HTTP(S) URL. */
function isAllowedIframeSrc(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Enforce iframe attributes after DOMPurify has allowed the tag. */
function normalizePreviewIframes(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("iframe").forEach((frame) => {
    if (!isAllowedIframeSrc(frame.getAttribute("src"))) {
      frame.remove();
      return;
    }
    frame.removeAttribute("srcdoc");
    frame.setAttribute("sandbox", "");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "lazy");
  });
  return template.innerHTML;
}

/** Handle the iframe preview toggle while keeping it tied to sanitized HTML mode. */
function handleIframeToggle(value: boolean): void {
  if (!allowHtml.value || allowScript.value) return;
  allowIframe.value = value;
}

/** Gate script preview behind explicit per-session confirmation. */
function handleScriptToggle(value: boolean): void {
  if (!value) {
    allowScript.value = false;
    scriptConfirmationVisible.value = false;
    return;
  }
  if (!allowHtml.value) return;
  scriptConfirmationVisible.value = true;
}

/** Enable the unsafe script preview mode for the current component instance. */
function confirmScriptPreview(): void {
  allowScript.value = true;
  scriptConfirmationVisible.value = false;
}

/** Cancel a pending request to enable script preview mode. */
function cancelScriptPreview(): void {
  scriptConfirmationVisible.value = false;
}
</script>

<template>
  <div class="markdown-editor-field">
    <div class="markdown-editor-field__toolbar">
      <SelectButton
        v-model="previewMode"
        :options="modeOptions"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        :disabled="disabled"
        :aria-label="t('contents.markdown_editor.mode_label')"
        data-test="markdown-mode"
      />
    </div>

    <div v-if="scriptConfirmationVisible" class="markdown-editor-field__script-warning" role="alert" data-test="markdown-script-warning">
      <div>
        <strong>{{ t("contents.markdown_editor.script_warning_title") }}</strong>
        <p>{{ t("contents.markdown_editor.script_warning_body") }}</p>
      </div>
      <div class="markdown-editor-field__script-actions">
        <Button type="button" size="small" severity="secondary" :label="t('common.cancel')" data-test="markdown-cancel-script" @click="cancelScriptPreview" />
        <Button
          type="button"
          size="small"
          severity="danger"
          :label="t('contents.markdown_editor.enable_script')"
          data-test="markdown-confirm-script"
          @click="confirmScriptPreview"
        />
      </div>
    </div>

    <div :class="['markdown-editor-field__body', `markdown-editor-field__body--${previewMode}`]">
      <div v-if="showEditor" class="markdown-editor-field__editor" data-test="markdown-editor">
        <CodeMirrorInput
          :id="id"
          v-model="markdownModel"
          :extensions="editorExtensions"
          :disabled="disabled"
          :placeholder="placeholder"
          height="auto"
          min-height="3rem"
          max-height="18rem"
        />
      </div>

      <div v-if="showPreview" class="markdown-editor-field__preview" data-test="markdown-preview">
        <div class="markdown-editor-field__preview-header">
          <span>{{ t("contents.markdown_editor.preview_label") }}</span>
          <div class="markdown-editor-field__toggles" role="group" :aria-label="t('contents.markdown_editor.preview_controls')">
            <div class="markdown-toggle">
              <ToggleSwitch :id="htmlToggleId" v-model="allowHtml" :disabled="disabled" data-test="markdown-toggle-html" />
              <label :for="htmlToggleId">{{ t("contents.markdown_editor.toggle_html") }}</label>
            </div>
            <div class="markdown-toggle">
              <ToggleSwitch
                :id="iframeToggleId"
                :modelValue="allowIframe"
                :disabled="disabled || iframeDisabled"
                data-test="markdown-toggle-iframe"
                @update:modelValue="handleIframeToggle"
              />
              <label :for="iframeToggleId">{{ t("contents.markdown_editor.toggle_iframe") }}</label>
            </div>
            <div class="markdown-toggle">
              <ToggleSwitch
                :id="scriptToggleId"
                :modelValue="allowScript"
                :disabled="disabled || scriptDisabled"
                data-test="markdown-toggle-script"
                @update:modelValue="handleScriptToggle"
              />
              <label :for="scriptToggleId">{{ t("contents.markdown_editor.toggle_script") }}</label>
            </div>
          </div>
        </div>
        <iframe
          class="markdown-editor-field__frame"
          :title="t('contents.markdown_editor.preview_label')"
          :sandbox="previewSandbox"
          :srcdoc="previewDocument"
          referrerpolicy="no-referrer"
          data-test="markdown-preview-frame"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.markdown-editor-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.markdown-editor-field__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex-wrap: wrap;
}

.markdown-editor-field__toggles {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex-wrap: wrap;
  flex: 1 1 16rem;
  justify-content: flex-end;
  margin-inline-start: auto;
  min-inline-size: min(100%, 14rem);
  row-gap: var(--space-4);
}

.markdown-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--surface-700);
  font-size: var(--font-13);
  white-space: nowrap;
}

.markdown-editor-field__script-warning {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  padding: var(--space-12);
  border: 1px solid var(--orange-500);
  border-radius: var(--radius-2);
  background: var(--yellow-100);
  color: var(--yellow-800);
}

.markdown-editor-field__script-warning p {
  margin: var(--space-4) 0 0;
  color: var(--yellow-800);
  font-size: var(--font-13);
}

.markdown-editor-field__script-actions {
  display: flex;
  gap: var(--space-8);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.markdown-editor-field__body {
  display: grid;
  gap: var(--space-12);
}

.markdown-editor-field__body--split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.markdown-editor-field__body--edit,
.markdown-editor-field__body--preview {
  grid-template-columns: minmax(0, 1fr);
}

.markdown-editor-field__editor,
.markdown-editor-field__preview {
  min-width: 0;
}

.markdown-editor-field__editor {
  align-self: start;
}

.markdown-editor-field__preview {
  display: flex;
  flex-direction: column;
  min-height: 18rem;
  border: 1px solid var(--surface-300);
  border-radius: var(--radius-2);
  overflow: hidden;
  background: var(--surface-0);
}

.markdown-editor-field__preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-8);
  flex-wrap: wrap;
  padding: var(--space-8) var(--space-12);
  border-bottom: 1px solid var(--surface-200);
  color: var(--surface-700);
  font-size: var(--font-13);
}

.markdown-editor-field__frame {
  width: 100%;
  flex: 1;
  min-height: 15rem;
  border: 0;
  background: var(--surface-0);
}

@media (max-width: 760px) {
  .markdown-editor-field__toolbar {
    align-items: flex-start;
  }

  .markdown-editor-field__body--split {
    grid-template-columns: minmax(0, 1fr);
  }

  .markdown-editor-field__script-warning {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
