<script lang="ts" setup>
import { computed, toRef } from "vue";
import { Dialog } from "@/components/ui/element-plus";
import Button from "@/components/NabeButton.vue";
import { Tag } from "@/components/ui/element-plus";
import { useI18n } from "vue-i18n";
import FieldTypeSelectStep from "./model-field/add-field/FieldTypeSelectStep.vue";
import { useFieldDefinitionForm } from "./model-field/add-field/useFieldDefinitionForm";
import ModelFieldDefinitionForm from "./model-field/ModelFieldDefinitionForm.vue";
import type { SubmitPayload } from "./model-field/add-field/types";

const props = defineProps<{ visible: boolean }>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", payload: SubmitPayload): void;
}>();

const { t } = useI18n();
const visibleRef = toRef(props, "visible");

const formApi = useFieldDefinitionForm(t, visibleRef);

const { step, selectedFieldType, fieldTypes, isSubmitDisabled, handleSelectType, goBackToSelect, buildPayload } = formApi;

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});

const dialogTitle = computed(() => t("models.detail.add_field_dialog.title"));
const configureTitle = computed(() => t("models.detail.add_field_dialog.configure_title"));

function closeDialog() {
  emit("update:visible", false);
}

function handleConfirm() {
  const payload = buildPayload();
  if (!payload) return;
  emit("submit", payload);
  closeDialog();
}
</script>

<template>
  <Dialog v-model:visible="dialogVisible" modal :draggable="false" class="add-field-dialog" :style="{ width: '720px', maxWidth: '95vw' }">
    <template #header>
      <div class="afd-header">
        <h3 class="afd-title">{{ dialogTitle }}</h3>
        <p class="afd-subtitle" v-if="step === 'select'">{{ t("models.detail.add_field_dialog.subtitle") }}</p>
        <p class="afd-subtitle" v-else>
          {{ configureTitle }}
          <Tag v-if="selectedFieldType" severity="secondary" class="ml-2">{{ selectedFieldType }}</Tag>
        </p>
      </div>
    </template>

    <FieldTypeSelectStep v-if="step === 'select'" :field-types="fieldTypes" @select="handleSelectType" />

    <div v-else class="form-body">
      <div class="form-header">
        <Button severity="secondary" variant="text" size="small" icon="lucide:chevron-left" :label="t('common.back')" @click="goBackToSelect" />
      </div>

      <ModelFieldDefinitionForm :api="formApi" />
    </div>

    <template #footer>
      <div class="afd-footer">
        <Button severity="secondary" :label="t('common.cancel')" @click="closeDialog" />
        <Button severity="primary" :disabled="isSubmitDisabled" :label="t('models.detail.add_field_dialog.add')" @click="handleConfirm" />
      </div>
    </template>
  </Dialog>
</template>

<style scoped lang="scss">
.add-field-dialog :deep(.el-dialog__header) {
  border-bottom: 1px solid var(--surface-200);
}

.add-field-dialog {
  .afd-header {
    .afd-title {
      margin: 0;
      font-size: var(--font-18);
      font-weight: 700;
      color: var(--surface-900);
    }

    .afd-subtitle {
      margin: var(--space-4) 0 0 0;
      font-size: var(--font-14);
      color: var(--surface-600);
      display: flex;
      align-items: center;
      gap: var(--space-8);
    }
  }
}

.afd-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.form-header {
  display: flex;
  justify-content: flex-start;
}
</style>
