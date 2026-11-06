<script setup lang="ts">
import { computed } from "vue";
import { Icon } from "@iconify/vue";
import { resolveIconName } from "@/utils/icons";

defineOptions({ inheritAttrs: false });

const {
  ariaLabel = null,
  icon,
  inline = true,
  spin = false,
} = defineProps<{
  ariaLabel?: string | null;
  icon: string;
  inline?: boolean;
  spin?: boolean;
}>();

const resolvedIcon = computed(() => resolveIconName(icon));
const ariaHidden = computed(() => (ariaLabel ? undefined : "true"));
</script>

<template>
  <Icon
    v-bind="$attrs"
    class="nabe-icon"
    :class="{ 'nabe-icon--spin': spin }"
    :icon="resolvedIcon"
    :inline="inline"
    :aria-hidden="ariaHidden"
    :aria-label="ariaLabel ?? undefined"
  />
</template>

<style scoped>
.nabe-icon {
  display: inline-block;
  flex: 0 0 auto;
  width: 1em;
  height: 1em;
  color: currentColor;
  vertical-align: -0.125em;
}

.nabe-icon--spin {
  animation: nabe-icon-spin 1s linear infinite;
}

@keyframes nabe-icon-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
