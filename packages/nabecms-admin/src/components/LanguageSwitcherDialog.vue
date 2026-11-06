<script lang="ts" setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "../stores/auth";
import type { UiLocale } from "../types/user-preferences";

import { Dialog } from "@/components/ui/element-plus";
import { Listbox } from "@/components/ui/element-plus";
const { t, locale } = useI18n();
const auth = useAuthStore();

const options = [
  { label: "English", value: "en" },
  { label: "日本語", value: "ja" },
];

const dialogVisible = ref(false);
const tempSelection = ref<UiLocale>(locale.value as UiLocale);
const updating = ref(false);

/**
 * Open the language selector dialog and sync the current selection.
 */
const openDialog = () => {
  tempSelection.value = locale.value as UiLocale;
  dialogVisible.value = true;
};

defineExpose({
  openDialog,
});

// Close dialog immediately when a new locale is chosen
watch(tempSelection, async (val, oldVal) => {
  if (val === oldVal || !dialogVisible.value || updating.value) return;
  updating.value = true;
  try {
    await auth.updatePreferences({ locale: val });
    dialogVisible.value = false;
  } catch (error) {
    console.error("Failed to update locale", error);
    tempSelection.value = oldVal as UiLocale;
  } finally {
    updating.value = false;
  }
});
</script>

<template>
  <Dialog v-model:visible="dialogVisible" modal :draggable="false" :header="t('app.language') || 'Language'" :style="{ width: '22rem' }">
    <div class="dialog-content">
      <Listbox v-model="tempSelection" :options="options" optionLabel="label" optionValue="value" :pt="{ root: { style: 'width: 100%' } }" />
    </div>
  </Dialog>
</template>

<style lang="scss" scoped>
.dialog-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
</style>
