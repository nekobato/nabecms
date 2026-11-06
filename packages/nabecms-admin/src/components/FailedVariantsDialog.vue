<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { fetchFailedVariants, retryMediaVariant, type FailedMediaVariant } from "@/services/mediaSettings";

import Button from "@/components/NabeButton.vue";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { Dialog } from "@/components/ui/element-plus";
const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "update:visible", value: boolean): void; (e: "updated", value: FailedMediaVariant[]): void }>();

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const failedVariants = ref<FailedMediaVariant[]>([]);

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});

/**
 * Load failed media variants from the API.
 */
const loadFailedVariants = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const items = await fetchFailedVariants(authStore);
    failedVariants.value = items;
    emit("updated", items);
  } catch (error) {
    errorMessage.value = t("media.failed.error_fetch");
    console.error(error);
  } finally {
    loading.value = false;
  }
};

/**
 * Retry a failed media variant.
 * @param variant - Failed variant record
 */
const handleRetry = async (variant: FailedMediaVariant) => {
  try {
    await retryMediaVariant(authStore, variant.mediaId, variant.templateKey);
    await loadFailedVariants();
    toast.add({
      severity: "success",
      summary: t("media.failed.title"),
      detail: t("media.failed.retry_success"),
      life: 3000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("media.failed.retry_error");
    toast.add({
      severity: "error",
      summary: t("media.failed.title"),
      detail: message,
      life: 4000,
    });
  }
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      loadFailedVariants();
      return;
    }
    errorMessage.value = null;
  },
);
</script>

<template>
  <Dialog v-model:visible="dialogVisible" modal :draggable="false" :header="t('media.failed.title')" :style="{ width: '48rem' }" class="failed-variants-dialog">
    <div class="dialog-body">
      <div v-if="loading" class="loading">{{ t("media.failed.loading") }}</div>
      <div v-else-if="errorMessage" class="error">{{ errorMessage }}</div>
      <div v-else>
        <div v-if="failedVariants.length === 0" class="empty">{{ t("media.failed.empty") }}</div>
        <ElTable v-else :data="failedVariants" row-key="id" size="small" class="failed-table">
          <ElTableColumn :label="t('media.failed.media')">
            <template #default="slotProps">
              <span>{{ slotProps.row.mediaName || slotProps.row.mediaId }}</span>
            </template>
          </ElTableColumn>
          <ElTableColumn prop="templateKey" :label="t('media.failed.template')" />
          <ElTableColumn :label="t('media.failed.error')">
            <template #default="slotProps">
              <span>{{ slotProps.row.error || "-" }}</span>
            </template>
          </ElTableColumn>
          <!-- @vue-generic {FailedMediaVariant} -->
          <ElTableColumn :label="t('media.failed.actions')">
            <template #default="slotProps">
              <Button size="small" severity="secondary" :label="t('media.failed.retry')" @click="handleRetry(slotProps.row)" />
            </template>
          </ElTableColumn>
        </ElTable>
      </div>
    </div>

    <template #footer>
      <Button severity="secondary" icon="lucide:x" :label="t('media.failed.close')" @click="emit('update:visible', false)" />
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.failed-variants-dialog {
  .dialog-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
  }

  .loading,
  .error,
  .empty {
    color: var(--surface-500);
    padding: var(--space-12) 0;
  }

  .failed-table {
    margin-top: var(--space-4);
  }
}
</style>
