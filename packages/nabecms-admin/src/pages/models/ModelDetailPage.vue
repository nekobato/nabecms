<script lang="ts" setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import ModelFieldCreateDialog from "@/components/ModelFieldCreateDialog.vue";
import ModelFieldEditDialog from "@/components/ModelFieldEditDialog.vue";
import ModelFieldsTable from "@/components/model-field/ModelFieldsTable.vue";
import ModelEditForm, { type ModelForm } from "@/components/model/ModelEditForm.vue";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";
import { useModelDetail } from "./useModelDetail";

const { t } = useI18n();

const {
  model,
  fields,
  loading,
  errorMessage,
  formattedCreatedAt,
  formattedUpdatedAt,
  modelForm,
  editingSubmitting,
  titleFieldDraftId,
  showAddFieldDialog,
  showEditFieldDialog,
  editingFieldPayload,
  deletingFieldIds,
  showDeleteDialog,
  deletingModel,
  dependenciesLoading,
  dependenciesError,
  dependencies,
  hasUnsavedOrderChanges,
  applyingOrder,
  canDeleteModel,
  addField,
  editField,
  deleteField,
  handleFieldCreated,
  handleFieldUpdated,
  handleRowReorder,
  applyFieldOrder,
  updateModel,
  openDeleteDialog,
  performDelete,
  refreshDependencies,
} = useModelDetail();

const combinedDirty = computed(() => hasUnsavedOrderChanges.value);
const savingAll = ref(false);
const showModelEditDialog = ref(false);
const modelEditFormRef = ref<InstanceType<typeof ModelEditForm> | null>(null);
const modelEditDirty = ref(false);
const modelEditValid = ref(true);

const saveDisabled = computed(() => {
  if (!combinedDirty.value) return true;
  return savingAll.value || applyingOrder.value;
});

const saveLoading = computed(() => savingAll.value || applyingOrder.value);
const saveButtonSeverity = computed(() => {
  if (!combinedDirty.value) return "secondary";
  return "success";
});
const saveButtonVariant = computed(() => (combinedDirty.value ? undefined : "outlined"));
const saveButtonRaised = computed(() => combinedDirty.value);
const saveButtonLabel = computed(() => {
  if (!combinedDirty.value) return t("models.detail.save_idle");
  return t("models.detail.save_all");
});

const editDisabled = computed(() => savingAll.value || editingSubmitting.value || applyingOrder.value);
const saveModelDisabled = computed(() => editingSubmitting.value || !modelEditDirty.value || !modelEditValid.value);

/** Open the model metadata edit dialog with a clean validation state. */
const openModelEditDialog = () => {
  modelEditDirty.value = false;
  modelEditValid.value = true;
  showModelEditDialog.value = true;
};

/** Close the model edit dialog unless a save request is already running. */
const closeModelEditDialog = () => {
  if (editingSubmitting.value) return;
  showModelEditDialog.value = false;
};

/** Submit the model edit form from the dialog footer. */
const submitModelEditDialog = async () => {
  if (saveModelDisabled.value) return;
  await modelEditFormRef.value?.submitForm();
};

/** Persist model title and description edits made inside the dialog. */
const handleModelEditSubmit = async (payload: ModelForm) => {
  const saved = await updateModel(payload);
  if (saved) {
    showModelEditDialog.value = false;
  }
};

/** Move destructive model deletion into the existing confirmation flow. */
const openDeleteDialogFromModelEdit = () => {
  showModelEditDialog.value = false;
  openDeleteDialog();
};

const setModelEditDirty = (value: boolean) => {
  modelEditDirty.value = value;
};

const setModelEditValid = (value: boolean) => {
  modelEditValid.value = value;
};

const saveAll = async () => {
  if (!combinedDirty.value || savingAll.value) return;
  savingAll.value = true;
  try {
    if (hasUnsavedOrderChanges.value) {
      await applyFieldOrder();
    }
  } finally {
    savingAll.value = false;
  }
};
</script>

<template>
  <div class="model-detail">
    <div v-if="loading" class="loading-state">
      <Card class="loading-card">
        <template #content>
          <div class="loading-content">
            <NabeIcon :icon="ICONS.loading" class="text-2xl" spin />
            <p class="loading-text">{{ t("models.detail.loading") }}</p>
          </div>
        </template>
      </Card>
    </div>

    <div v-else-if="errorMessage" class="error-state">
      <Card class="error-card">
        <template #content>
          <div class="error-content">
            <NabeIcon :icon="ICONS.error" class="text-2xl" />
            <p class="error-text">{{ errorMessage }}</p>
          </div>
        </template>
      </Card>
    </div>

    <div v-else-if="model" class="detail-content">
      <PageSectionHeader :title="model.name" :description="model.description">
        <template #actions>
          <div class="header-actions">
            <Button
              @click="openModelEditDialog"
              severity="success"
              class="edit-button"
              :icon="ICONS.edit"
              :label="t('models.detail.edit')"
              :disabled="editDisabled"
            />
            <div class="save-actions">
              <Button
                @click="saveAll"
                :severity="saveButtonSeverity"
                :variant="saveButtonVariant"
                :raised="saveButtonRaised"
                class="save-button"
                icon="lucide:check"
                :disabled="saveDisabled"
                :loading="saveLoading"
                :label="saveButtonLabel"
              />
            </div>
          </div>
        </template>
      </PageSectionHeader>

      <div class="stats-grid">
        <Card class="stat-card stat-card--summary">
          <template #content>
            <div class="stat-content stat-content--summary">
              <div class="stat-meta-row">
                <h3 class="stat-label">{{ t("models.detail.public_state") }}</h3>
                <Tag
                  :value="model.isPublic ? t('models.detail.public') : t('models.detail.private')"
                  :severity="model.isPublic ? 'success' : 'secondary'"
                  class="stat-value-tag"
                />
              </div>
              <div class="stat-meta-row">
                <h3 class="stat-label">{{ t("models.detail.created_at") }}</h3>
                <p class="stat-value stat-value--text">{{ formattedCreatedAt }}</p>
              </div>
              <div class="stat-meta-row">
                <h3 class="stat-label">{{ t("models.detail.updated_at") }}</h3>
                <p class="stat-value stat-value--text">{{ formattedUpdatedAt }}</p>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <ModelFieldsTable
        :fields="fields"
        :has-unsaved-order-changes="hasUnsavedOrderChanges"
        :applying-order="applyingOrder"
        :show-order-actions="false"
        :title-field-id="titleFieldDraftId"
        :deleting-field-ids="deletingFieldIds"
        @row-reorder="handleRowReorder"
        @edit-field="editField"
        @delete-field="deleteField"
        @add-field="addField"
      />

      <ModelFieldCreateDialog v-model:visible="showAddFieldDialog" @submit="handleFieldCreated" />
      <ModelFieldEditDialog v-model:visible="showEditFieldDialog" :field="editingFieldPayload" @update-field="handleFieldUpdated" />
      <Dialog v-model:visible="showModelEditDialog" modal :draggable="false" class="edit-model-dialog" :style="{ width: '32rem' }" :closable="false">
        <template #header>
          <div class="edit-model-dialog__header">
            <h2 class="edit-model-dialog__title">{{ t("models.edit.title") }}</h2>
            <Button
              type="button"
              severity="danger"
              class="edit-dialog-delete-button"
              icon="lucide:trash-2"
              :label="t('models.detail.delete')"
              :disabled="editingSubmitting"
              @click="openDeleteDialogFromModelEdit"
            />
          </div>
        </template>

        <ModelEditForm
          v-if="showModelEditDialog"
          ref="modelEditFormRef"
          :model="modelForm"
          :submitting="editingSubmitting"
          :show-public-field="false"
          @submit="handleModelEditSubmit"
          @dirty-change="setModelEditDirty"
          @valid-change="setModelEditValid"
        />

        <template #footer>
          <div class="edit-model-dialog__footer">
            <Button
              type="button"
              severity="secondary"
              class="footer-cancel"
              :label="t('common.cancel')"
              :disabled="editingSubmitting"
              @click="closeModelEditDialog"
            />
            <Button
              type="button"
              severity="success"
              class="save-model-button"
              icon="lucide:check"
              :label="t('models.edit.submit')"
              :disabled="saveModelDisabled"
              :loading="editingSubmitting"
              @click="submitModelEditDialog"
            />
          </div>
        </template>
      </Dialog>
      <Dialog
        v-model:visible="showDeleteDialog"
        modal
        :draggable="false"
        class="delete-model-dialog"
        :header="model ? t('models.detail.delete_dialog.title', { name: model.name }) : t('models.detail.delete_dialog.title_short')"
        :style="{ width: '28rem' }"
      >
        <div class="delete-dialog-body">
          <p class="dialog-description">
            {{ model ? t("models.detail.delete_dialog.description", { name: model.name }) : t("models.detail.delete_dialog.description_short") }}
          </p>

          <div v-if="dependenciesLoading" class="dialog-loading">
            <NabeIcon :icon="ICONS.loading" class="dialog-loading__icon" spin />
            <span>{{ t("models.detail.delete_dialog.checking") }}</span>
          </div>

          <div v-else>
            <div v-if="dependenciesError" class="dialog-error">
              <div class="error-header">
                <NabeIcon :icon="ICONS.error" />
                <span>{{ dependenciesError }}</span>
              </div>
              <Button size="small" severity="secondary" class="refresh-button" :label="t('models.detail.delete_dialog.retry')" @click="refreshDependencies" />
            </div>

            <div v-else-if="dependencies.length > 0" class="dialog-dependencies">
              <p class="blocked-message">
                {{ t("models.detail.delete_dialog.blocked") }}
              </p>
              <ul class="dependency-list">
                <li v-for="item in dependencies" :key="item.fieldId" class="dependency-item">
                  <div class="dependency-main">
                    <span class="dependency-model">{{ item.modelName }}</span>
                    <span class="dependency-field">{{ item.fieldName }}</span>
                  </div>
                  <div class="dependency-tags">
                    <Tag :value="t('models.detail.delete_dialog.dependency_relation')" severity="secondary" />
                    <Tag
                      :value="item.relationVariant === 'one' ? t('models.detail.delete_dialog.variant_one') : t('models.detail.delete_dialog.variant_many')"
                      severity="info"
                    />
                  </div>
                </li>
              </ul>
              <Button size="small" severity="secondary" class="refresh-button" :label="t('models.detail.delete_dialog.refresh')" @click="refreshDependencies" />
            </div>
          </div>
        </div>

        <template #footer>
          <div class="dialog-footer">
            <Button
              type="button"
              severity="secondary"
              class="footer-cancel"
              :label="t('common.cancel')"
              :disabled="deletingModel"
              @click="showDeleteDialog = false"
            />
            <Button
              type="button"
              severity="danger"
              class="footer-delete"
              icon="lucide:trash-2"
              :label="t('models.detail.delete_dialog.confirm')"
              :disabled="deletingModel || !canDeleteModel"
              @click="performDelete"
            />
          </div>
        </template>
      </Dialog>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.model-detail {
  padding: var(--space-24);
  min-height: 100vh;
  background-color: var(--surface-50);

  .loading-state {
    .loading-card {
      max-width: 400px;
      margin: var(--space-64) auto;

      .loading-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-16);
        padding: var(--space-32);

        .loading-text {
          color: var(--surface-600);
          font-size: var(--font-16);
          margin: 0;
        }
      }
    }
  }

  .detail-content {
    .header-actions {
      display: flex;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: var(--space-12);

      .edit-button {
        min-width: 100px;
      }

      .save-actions {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        min-width: 10.5rem;
      }
    }

    .stats-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-24);
      margin-bottom: var(--space-32);

      .stat-card {
        .stat-content {
          &.stat-content--summary {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: var(--space-24);
          }

          .stat-meta-row {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: var(--space-8);
          }

          .stat-label {
            font-size: var(--font-14);
            font-weight: 500;
            color: var(--surface-600);
            margin: 0;
          }

          .stat-value {
            font-size: var(--font-18);
            font-weight: 600;
            color: var(--surface-900);
            margin: 0;
          }

          .stat-value--text {
            font-size: var(--font-14);
            font-weight: 400;
            line-height: 1.5;
          }

          .stat-value-tag {
            font-weight: 600;
          }
        }
      }
    }

    @media (max-width: 640px) {
      .stats-grid {
        grid-template-columns: 1fr;

        .stat-card .stat-content--summary {
          grid-template-columns: 1fr;
        }
      }
    }
  }

  .error-state {
    display: flex;
    justify-content: center;
    margin-top: var(--space-64);

    .error-card {
      max-width: 480px;
      .error-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-12);
        padding: var(--space-32);

        .error-text {
          color: var(--surface-600);
          font-size: var(--font-16);
          text-align: center;
          margin: 0;
        }
      }
    }
  }
}

.edit-model-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  width: 100%;

  .edit-model-dialog__title {
    margin: 0;
    font-size: var(--font-20);
    font-weight: 700;
    color: var(--surface-900);
  }
}

.edit-model-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-12);
}

.delete-model-dialog {
  .delete-dialog-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);

    .dialog-description {
      margin: 0;
      color: var(--surface-700);
      line-height: 1.5;
    }

    .dialog-loading {
      display: flex;
      align-items: center;
      gap: var(--space-12);
      color: var(--surface-700);

      .dialog-loading__icon {
        font-size: 1.125rem;
      }
    }

    .dialog-error {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);
      padding: var(--space-16);
      border-radius: 0.5rem;
      border: 1px solid var(--red-100);
      background-color: var(--red-50);
      color: var(--red-700);

      .error-header {
        display: flex;
        align-items: center;
        gap: var(--space-8);
      }

      .refresh-button {
        align-self: flex-start;
      }
    }

    .dialog-dependencies {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);

      .blocked-message {
        margin: 0;
        color: var(--red-700);
        font-weight: 600;
      }

      .dependency-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--space-12);

        .dependency-item {
          border: 1px solid var(--surface-200);
          border-radius: 0.5rem;
          padding: var(--space-12);
          display: flex;
          flex-direction: column;
          gap: var(--space-8);

          .dependency-main {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);

            .dependency-model {
              font-weight: 600;
              color: var(--surface-900);
            }

            .dependency-field {
              color: var(--surface-700);
            }
          }

          .dependency-tags {
            display: flex;
            gap: var(--space-8);
            flex-wrap: wrap;
          }
        }
      }

      .refresh-button {
        align-self: flex-start;
      }
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-12);
  }
}

@media (max-width: 640px) {
  .model-detail {
    padding: var(--space-16);

    .detail-content {
      .header-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
        gap: var(--space-8);
        width: 100%;

        .edit-button,
        .save-actions {
          min-width: 0;
          width: 100%;
        }

        :deep(.el-button) {
          width: 100%;
          min-width: 0;
          justify-content: center;
          padding-inline: var(--space-8);
        }
      }
    }
  }
}
</style>
