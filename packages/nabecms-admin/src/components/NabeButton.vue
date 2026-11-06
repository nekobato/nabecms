<script setup lang="ts">
/* eslint-disable vue/multi-word-component-names, vue/no-reserved-component-names -- Compatibility name for migrated Button test stubs. */
defineOptions({ name: "Button", inheritAttrs: false });

import { computed, useSlots } from "vue";
import { ElButton, ElIcon } from "element-plus";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";

const {
  icon = undefined,
  iconClass = undefined,
  iconPos = "left",
  label = undefined,
  loading = false,
  loadingIcon = ICONS.loading,
  severity = undefined,
  variant = undefined,
  outlined = false,
  text = false,
  rounded = false,
  type = "button",
} = defineProps<{
  icon?: string;
  iconClass?: string | object | unknown[];
  iconPos?: string;
  label?: string;
  loading?: boolean;
  loadingIcon?: string;
  severity?: string;
  variant?: "outlined" | "text" | "link";
  outlined?: boolean;
  text?: boolean;
  rounded?: boolean;
  type?: "button" | "submit" | "reset";
}>();

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

const slots = useSlots();
const hasDefaultSlot = computed(() => Boolean(slots.default));
const hasTextContent = computed(() => hasDefaultSlot.value || Boolean(label));
const hasLeftIcon = computed(() => loading || Boolean(icon && (iconPos !== "right" || !hasTextContent.value)));
const hasRightIcon = computed(() => Boolean(!loading && icon && iconPos === "right" && hasTextContent.value));
const elementType = computed(() => {
  if (severity === "danger" || severity === "error") return "danger";
  if (severity === "warn" || severity === "warning") return "warning";
  if (severity === "success" || severity === "info" || severity === "primary") return severity;
  return undefined;
});
</script>

<template>
  <ElButton
    v-bind="$attrs"
    :type="elementType"
    :native-type="type"
    :plain="outlined || variant === 'outlined'"
    :text="text || variant === 'text'"
    :link="variant === 'link'"
    :round="rounded"
    :disabled="loading || Boolean($attrs.disabled)"
    :aria-busy="loading"
    @click="emit('click', $event)"
  >
    <template v-if="hasLeftIcon" #icon>
      <NabeIcon :icon="loading ? loadingIcon : (icon ?? loadingIcon)" :class="['nabe-button__icon', iconClass]" :spin="loading" />
    </template>
    <template v-if="hasTextContent || hasRightIcon" #default>
      <slot v-if="hasDefaultSlot" />
      <span v-else-if="label" class="nabe-button__label">{{ label }}</span>
      <ElIcon v-if="hasRightIcon" class="el-icon--right">
        <NabeIcon :icon="icon ?? loadingIcon" :class="['nabe-button__icon', iconClass]" />
      </ElIcon>
    </template>
  </ElButton>
</template>

<style scoped>
.nabe-button__icon {
  flex: 0 0 auto;
}
</style>
