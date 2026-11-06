<script setup lang="ts">
import { computed, type CSSProperties } from "vue";
import { Codemirror } from "vue-codemirror";
import type { Extension } from "@codemirror/state";
import { basicSetup } from "codemirror";

type CodeMirrorInputProps = {
  id?: string;
  modelValue: string;
  disabled?: boolean;
  placeholder?: string;
  height?: string | number;
  minHeight?: string | number;
  maxHeight?: string | number;
  extensions?: Extension[];
};

const props = withDefaults(defineProps<CodeMirrorInputProps>(), {
  id: undefined,
  modelValue: "",
  disabled: false,
  placeholder: "",
  height: "14rem",
  minHeight: undefined,
  maxHeight: undefined,
  extensions: () => [],
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

/** Build a stable v-model binding for CodeMirror. */
const codeModel = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value),
});

/** Normalize CSS size props before passing them to the CodeMirror theme. */
function toCssSize(value: string | number | undefined): string | undefined {
  if (typeof value === "number") return `${value}px`;
  return value;
}

/** Normalize inline styles for the editor height. */
const editorStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    height: toCssSize(props.height),
  };
  const minHeight = toCssSize(props.minHeight);
  const maxHeight = toCssSize(props.maxHeight);
  if (minHeight) style.minHeight = minHeight;
  if (maxHeight) style.maxHeight = maxHeight;
  return style;
});

/** Merge default CodeMirror extensions with caller-provided ones. */
const resolvedExtensions = computed<Extension[]>(() => [basicSetup, ...props.extensions]);

/** Use a plain textarea when running tests to keep the environment lightweight. */
const useFallback = computed(() => import.meta.env.MODE === "test");
</script>

<template>
  <textarea
    v-if="useFallback"
    class="code-mirror-fallback"
    :id="id"
    :value="codeModel"
    :style="editorStyle"
    :disabled="disabled"
    :placeholder="placeholder"
    spellcheck="false"
    @input="(event) => (codeModel = (event.target as HTMLTextAreaElement).value)"
  />
  <Codemirror
    v-else
    v-model="codeModel"
    class="code-mirror-input"
    :id="id"
    :style="editorStyle"
    :extensions="resolvedExtensions"
    :disabled="disabled"
    :placeholder="placeholder"
    :indent-with-tab="true"
    :tab-size="2"
  />
</template>

<style scoped>
.code-mirror-fallback {
  width: 100%;
  min-height: 12rem;
  border: 1px solid var(--surface-300);
  border-radius: var(--radius-2);
  padding: var(--space-8);
  font-size: var(--font-14);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  background: var(--surface-0);
  color: var(--surface-900);
}

.code-mirror-input {
  border: 1px solid var(--surface-300);
  border-radius: var(--radius-2);
  overflow: hidden;
}

.code-mirror-input :deep(.cm-editor) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: var(--font-14);
}

.code-mirror-input :deep(.cm-scroller) {
  max-height: inherit;
  overflow: auto;
  padding: var(--space-8);
}

.code-mirror-input :deep(.cm-focused) {
  outline: none;
}
</style>
