<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElTable, ElTableColumn } from "element-plus";
import { VueDraggable, type DraggableEvent } from "vue-draggable-plus";
import Button from "@/components/NabeButton.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { Card, Checkbox, Tag } from "@/components/ui/element-plus";
import { ICONS } from "@/utils/icons";
import type { ModelField } from "@/pages/models/model-detail-types";

const props = defineProps<{
  fields: ModelField[];
  hasUnsavedOrderChanges: boolean;
  applyingOrder: boolean;
  showOrderActions?: boolean;
  titleFieldId?: string | null;
  editingInline?: boolean;
  deletingFieldIds?: Record<string, boolean>;
}>();

const emit = defineEmits<{
  (e: "row-reorder", value: ModelField[]): void;
  (e: "apply-order"): void;
  (e: "reset-order"): void;
  (e: "edit-field", fieldId: string): void;
  (e: "delete-field", fieldId: string): void;
  (e: "add-field"): void;
  (e: "select-title", fieldId: string | null): void;
}>();

const { t, te } = useI18n();

/**
 * Create an immutable field order from the drag indexes and pass it to the parent.
 */
const handleRowReorder = (event: DraggableEvent<ModelField>) => {
  const { oldIndex, newIndex } = event;
  if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;

  const reorderedFields = [...props.fields];
  const [movedField] = reorderedFields.splice(oldIndex, 1);
  if (!movedField) return;

  reorderedFields.splice(newIndex, 0, movedField);
  emit("row-reorder", reorderedFields);
};

const hasFields = computed(() => props.fields.length > 0);
const showOrderActions = computed(() => props.showOrderActions !== false);

/** Resolve the display label for a field variant. */
const fieldVariantLabel = (field: ModelField): string | null => {
  const variant = field.variant?.trim();
  if (!variant) return null;

  const key = `models.detail.add_field_dialog.variant_labels.${field.type}.${variant}`;
  return te(key) ? t(key) : variant;
};
</script>

<template>
  <Card class="fields-section">
    <template #header>
      <div class="fields-header">
        <div class="fields-title">
          <h2 class="section-title">{{ t("models.detail.fields") }}</h2>
          <p class="section-hint">{{ t("models.detail.order_hint") }}</p>
        </div>
        <div class="fields-actions">
          <template v-if="showOrderActions">
            <Tag v-if="hasUnsavedOrderChanges" :value="t('models.detail.unsaved_order')" severity="warning" class="unsaved-order-tag" />
            <Button
              @click="emit('reset-order')"
              severity="secondary"
              variant="outlined"
              size="small"
              class="order-button"
              :disabled="!hasUnsavedOrderChanges || applyingOrder"
              :label="t('models.detail.reset_order')"
            />
            <Button
              @click="emit('apply-order')"
              severity="info"
              size="small"
              class="order-button"
              icon="lucide:check"
              :loading="applyingOrder"
              :disabled="!hasUnsavedOrderChanges"
              :label="t('models.detail.apply_order')"
            />
          </template>
          <Button
            @click="emit('add-field')"
            severity="primary"
            size="small"
            class="add-field-button"
            icon="lucide:plus"
            :label="t('models.detail.add_field')"
          />
        </div>
      </div>
    </template>

    <template #content>
      <div v-if="!hasFields" class="empty-fields">
        <div class="empty-content">
          <NabeIcon :icon="ICONS.list" class="text-4xl text-gray-400" />
          <p class="empty-text">{{ t("models.detail.no_fields") }}</p>
          <Button @click="emit('add-field')" severity="secondary" size="small" class="mt-3" :label="t('models.detail.add_first_field')" />
        </div>
      </div>

      <div v-else class="fields-table-wrapper">
        <VueDraggable
          :model-value="props.fields"
          target=".el-table__body tbody"
          handle=".field-row-drag-handle"
          :animation="150"
          :custom-update="handleRowReorder"
        >
          <ElTable :data="props.fields" row-key="id" class="fields-table" stripe>
            <ElTableColumn width="48" align="center" class-name="reorder-cell">
              <template #default>
                <button type="button" class="field-row-drag-handle" :aria-label="t('models.detail.order_hint')">
                  <NabeIcon :icon="ICONS.sort" aria-hidden="true" />
                </button>
              </template>
            </ElTableColumn>
            <!-- @vue-generic {ModelField} -->
            <ElTableColumn :label="t('models.detail.title_column')" width="80" align="center" label-class-name="title-header">
              <template #default="{ row: data }">
                <div class="title-indicator">
                  <Checkbox
                    v-if="props.editingInline"
                    binary
                    :modelValue="data.id === props.titleFieldId"
                    :inputId="`title-${data.id}`"
                    @update:modelValue="(val: boolean) => emit('select-title', val ? data.id : null)"
                  />
                  <NabeIcon v-else-if="data.id === props.titleFieldId" :icon="ICONS.title" class="title-icon" />
                </div>
              </template>
            </ElTableColumn>
            <!-- @vue-generic {ModelField} -->
            <ElTableColumn :label="t('models.detail.field_name_column')" min-width="240">
              <template #default="{ row: data }">
                <div class="field-main">
                  <div class="field-name">{{ data.name }}</div>
                  <div class="field-tags">
                    <Tag :value="data.type" severity="secondary" class="type-tag" />
                    <Tag v-if="fieldVariantLabel(data)" :value="fieldVariantLabel(data) ?? ''" severity="info" size="small" class="variant-tag" />
                    <Tag v-if="data.required" :value="t('models.detail.required')" severity="danger" size="small" />
                    <Tag v-if="data.isUnique" :value="t('models.detail.unique')" severity="warning" size="small" />
                    <Tag v-if="data.hasLocales" :value="t('models.detail.multilingual')" severity="info" size="small" />
                    <Tag v-if="!data.isPrivate" :value="t('models.detail.is_public')" severity="success" size="small" />
                    <Tag v-if="data.isDisplayTitle" :value="t('models.detail.display_title')" severity="success" size="small" class="display-title-tag" />
                  </div>
                </div>
              </template>
            </ElTableColumn>
            <!-- @vue-generic {ModelField} -->
            <ElTableColumn :label="t('models.detail.actions')" width="128" align="right" class-name="actions-cell">
              <template #default="{ row: data }">
                <div class="field-action-buttons">
                  <Button
                    @click="emit('edit-field', data.id)"
                    severity="secondary"
                    text
                    rounded
                    size="small"
                    icon="lucide:pencil"
                    class="edit-field-button"
                    :aria-label="t('models.detail.edit')"
                  />
                  <Button
                    @click="emit('delete-field', data.id)"
                    severity="danger"
                    text
                    rounded
                    size="small"
                    icon="lucide:trash-2"
                    class="delete-field-button"
                    :loading="props.deletingFieldIds?.[data.id] === true"
                    :disabled="props.deletingFieldIds?.[data.id] === true"
                    :aria-label="t('models.detail.delete_field')"
                  />
                </div>
              </template>
            </ElTableColumn>
          </ElTable>
        </VueDraggable>
      </div>
    </template>
  </Card>
</template>

<style scoped lang="scss">
.fields-header {
  padding: var(--space-24) var(--space-24) 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-12);
  width: 100%;

  .fields-title {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);

    .section-title {
      font-size: var(--font-18);
      font-weight: 600;
      color: var(--surface-900);
      margin: 0;
    }

    .section-hint {
      margin: 0;
      color: var(--surface-600);
      font-size: var(--font-14);
    }
  }

  .fields-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-8);

    .order-button,
    .add-field-button {
      min-width: 110px;
    }

    .unsaved-order-tag {
      font-weight: 600;
    }
  }
}

.empty-fields {
  padding: var(--space-48) 0;

  .empty-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-16);

    .empty-text {
      color: var(--surface-600);
      font-size: var(--font-16);
      margin: 0;
    }
  }
}

.fields-table-wrapper {
  padding: 0 var(--space-24) var(--space-24);
}

:deep(.el-table) {
  border: none;
}

:deep(.el-table__header th.el-table__cell) {
  background-color: var(--surface-50);
  font-weight: 600;
  color: var(--surface-700);
}

:deep(.el-table__body td.el-table__cell) {
  border-color: var(--surface-200);
}

.field-row-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: grab;
  color: var(--surface-500);

  &:hover,
  &:focus-visible {
    color: var(--primary-600);
    background: var(--surface-100);
  }

  &:active {
    cursor: grabbing;
  }
}

.field-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.field-name {
  font-size: var(--font-16);
  font-weight: 600;
  color: var(--surface-900);
  margin: 0;
}

.field-tags {
  display: flex;
  gap: var(--space-8);
  flex-wrap: wrap;

  .type-tag {
    font-weight: 500;
  }

  .variant-tag {
    font-weight: 500;
  }

  .display-title-tag {
    font-weight: 700;
  }
}

.title-cell {
  text-align: center;

  .title-indicator {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .title-icon {
    color: var(--primary-600);
    font-size: 1rem;
  }
}

.title-header {
  text-align: center;
}

.actions-cell {
  text-align: right;

  .field-action-buttons {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
  }

  .edit-field-button,
  .delete-field-button {
    border: none;
  }
}
</style>
