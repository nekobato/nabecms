<script lang="ts" setup>
import { computed, ref, watchEffect } from "vue";
import { ElPagination, ElTable, ElTableColumn, ElTabPane, ElTabs } from "element-plus";
import EntryForm from "@/components/EntryForm.vue";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Referenced by @vue-generic template annotations.
import type { EntryBackReference } from "@/services/entryReferences";
import { useEntryEditPage } from "./entry-edit/useEntryEditPage";

import Button from "@/components/NabeButton.vue";
import { RadioButton } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
import { referenceActionsId, useReferenceSession } from "./entry-edit/referenceSession";
import { getCachedEntryReference } from "@/services/entryReferences";
const props = defineProps<{ modelId: string; entryId: string; embedded?: boolean }>();
const referenceActionsTarget = computed(() => `[id="${referenceActionsId(props)}"]`);
const referenceSession = useReferenceSession();
const {
  t,
  model,
  entry,
  publishedFormValues,
  formKey,
  loading,
  formSubmitting,
  errorMessage,
  savingDraft,
  publishingEntry,
  deletingEntry,
  activeTab,
  localeFilter,
  locales,
  draftFormRef,
  formDirty,
  defaultLocaleCode,
  backRefRelations,
  backRefRichText,
  backRefDialogVisible,
  backRefLoading,
  backRefDialogMode,
  hasBackReferences,
  referenceRowsPerPageOptions,
  revisions,
  revisionsLoading,
  restoringRevision,
  selectedRevisionId,
  historyDialogVisible,
  canRestoreSelectedRevision,
  hasDraftChanges,
  draftInitialValues,
  saveDraftLabel,
  publishLabel,
  breadcrumbModel,
  openHistoryDialog,
  confirmRestoreRevision,
  handleDraft,
  confirmPublishEntry,
  handleSubmit,
  deleteEntry,
  confirmDeleteWithDetachedReferences,
  formatDate,
  formatRevisionDate,
  normalizeRevisionStatus,
  revisionStatusSeverity,
  isCurrentRevision,
  triggerDraftAction,
  triggerPublishAction,
  openBackReferences,
  navigateToReference,
} = useEntryEditPage(props);

watchEffect(() => {
  referenceSession?.update(props, {
    dirty: formDirty.value,
    busy: formSubmitting.value || deletingEntry.value || restoringRevision.value,
    available: !!entry.value,
    title: getCachedEntryReference(props.entryId)?.displayTitle ?? props.entryId,
    modelName: model.value?.name,
  });
});

const editorTab = computed({
  get: () => (props.embedded ? `${props.entryId}-${activeTab.value}` : activeTab.value),
  set: (value: string) => {
    activeTab.value = value.endsWith("published") ? "published" : "draft";
  },
});
const relationPage = ref(1);
const relationPageSize = ref(5);
const richTextPage = ref(1);
const richTextPageSize = ref(5);
const paginatedBackRefRelations = computed(() => {
  const start = (relationPage.value - 1) * relationPageSize.value;
  return backRefRelations.value.slice(start, start + relationPageSize.value);
});
const paginatedBackRefRichText = computed(() => {
  const start = (richTextPage.value - 1) * richTextPageSize.value;
  return backRefRichText.value.slice(start, start + richTextPageSize.value);
});
</script>

<template>
  <div class="entry-edit-page" :class="{ embedded }">
    <Dialog
      v-model:visible="historyDialogVisible"
      modal
      :header="t('contents.edit.history_title')"
      class="history-dialog"
      :style="{ width: '520px' }"
      :draggable="false"
    >
      <div class="history-card">
        <p class="history-subtext">{{ t("contents.edit.history_hint") }}</p>

        <div v-if="revisionsLoading" class="history-loading">
          <p>{{ t("common.loading") }}</p>
        </div>
        <div v-else-if="revisions.length === 0" class="history-empty">
          {{ t("contents.edit.history_empty") }}
        </div>
        <template v-else>
          <ul class="revision-list">
            <li v-for="revision in revisions" :key="revision.id" class="revision-item" :class="{ current: isCurrentRevision(revision) }">
              <RadioButton
                :inputId="`revision-${revision.id}`"
                v-model="selectedRevisionId"
                :value="revision.id"
                :disabled="isCurrentRevision(revision) || !revision.hasContent"
              />
              <label class="revision-body" :for="`revision-${revision.id}`">
                <div class="revision-date">{{ formatRevisionDate(revision.createdAt) }}</div>
                <div class="revision-meta">
                  <Tag v-if="isCurrentRevision(revision)" :value="t('contents.edit.history_current_badge')" severity="secondary" />
                  <Tag :value="t(`contents.entries.status_${normalizeRevisionStatus(revision.status)}`)" :severity="revisionStatusSeverity(revision.status)" />
                </div>
              </label>
            </li>
          </ul>
          <div class="history-footer">
            <Button
              class="restore-button"
              icon="lucide:history"
              :label="t('contents.edit.history_restore_button')"
              :loading="restoringRevision"
              :disabled="!canRestoreSelectedRevision"
              @click="confirmRestoreRevision"
            />
            <span class="history-note">{{ t("contents.edit.history_restore_note") }}</span>
          </div>
        </template>
      </div>
    </Dialog>

    <PageSectionHeader
      :title="embedded ? (getCachedEntryReference(entryId)?.displayTitle ?? entryId) : t('contents.edit.title')"
      :breadcrumb-model="embedded ? [] : breadcrumbModel"
    >
      <div class="title-info">
        <div class="status-chips" v-if="entry">
          <span class="status-chip" :class="entry.status">{{ t(`contents.entries.status_${entry.status}`) }}</span>
          <span v-if="hasDraftChanges" class="status-chip draft">{{ t("contents.edit.draft_badge") }}</span>
        </div>
        <div v-if="entry" class="meta-info">
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">{{ t("contents.edit.meta_created") }}</span>
              <span class="meta-value">{{ formatDate(entry.createdAt) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ t("contents.edit.meta_updated") }}</span>
              <span class="meta-value">{{ formatDate(entry.updatedAt) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ t("contents.edit.meta_published") }}</span>
              <span class="meta-value">{{ formatDate(entry.publishedAt) }}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">{{ t("contents.edit.meta_updated_by") }}</span>
              <span class="meta-value">{{ entry.updatedByName ?? entry.updatedBy ?? "-" }}</span>
            </div>
          </div>
          <div class="meta-actions">
            <Button
              size="small"
              severity="secondary"
              icon="lucide:clock"
              :label="t('contents.edit.history_button')"
              :disabled="revisionsLoading"
              @click="openHistoryDialog"
            />
            <Button size="small" severity="secondary" icon="lucide:link" :label="t('contents.edit.references_button')" @click="openBackReferences" />
          </div>
        </div>
      </div>
    </PageSectionHeader>

    <div v-if="loading" class="loading-state">
      <p>{{ t("contents.edit.loading") }}</p>
    </div>

    <div v-else>
      <div v-if="model && entry" class="form-container">
        <Teleport defer :to="referenceActionsTarget" :disabled="!embedded">
          <div class="workflow-actions" v-if="model && entry">
            <div class="action-buttons">
              <Button
                type="button"
                severity="primary"
                icon="lucide:save"
                :disabled="formSubmitting || activeTab !== 'draft'"
                :loading="savingDraft"
                :label="saveDraftLabel"
                @click="triggerDraftAction"
              />
              <Button
                type="button"
                severity="success"
                icon="lucide:upload"
                :disabled="formSubmitting || activeTab !== 'draft'"
                :loading="publishingEntry"
                :label="publishLabel"
                @click="triggerPublishAction"
              />
            </div>
            <div class="action-note" v-if="localeFilter !== 'all'">
              {{ t("contents.edit.locale_action_note", { locale: localeFilter }) }}
            </div>
            <div class="danger-actions" v-if="!embedded">
              <Button
                type="button"
                class="delete-entry-button"
                @click="deleteEntry"
                :disabled="!entry || formSubmitting || deletingEntry"
                :loading="deletingEntry"
                severity="danger"
                icon="lucide:trash-2"
                :label="t('contents.edit.delete')"
              />
            </div>
          </div>
        </Teleport>
        <ElTabs v-model="editorTab">
          <ElTabPane :label="t('contents.edit.tab_published')" :name="embedded ? `${entryId}-published` : 'published'">
            <div class="tab-panel-content">
              <div v-if="entry" class="readonly-form">
                <EntryForm
                  :key="`published-${formKey}`"
                  mode="edit"
                  :model="model"
                  :initial-values="publishedFormValues"
                  :loading="false"
                  :hide-actions="true"
                  :enable-workflow-actions="false"
                  :readonly="true"
                  :input-id-prefix="embedded ? `reference-${entryId}-published-` : 'published-'"
                  :locales="locales"
                  :default-locale="defaultLocaleCode"
                  v-model:locale-filter="localeFilter"
                />
              </div>
              <div v-else class="empty-state">
                <p>{{ t("contents.edit.no_published_data") }}</p>
              </div>
            </div>
          </ElTabPane>
          <ElTabPane :label="t('contents.edit.tab_draft')" :name="embedded ? `${entryId}-draft` : 'draft'">
            <div class="tab-panel-content">
              <div v-if="model" class="draft-panel">
                <EntryForm
                  ref="draftFormRef"
                  :key="formKey"
                  mode="edit"
                  :model="model"
                  :initial-values="draftInitialValues"
                  :loading="savingDraft || publishingEntry"
                  :enable-workflow-actions="true"
                  :hide-workflow-actions="true"
                  :input-id-prefix="embedded ? `reference-${entryId}-draft-` : 'draft-'"
                  :locales="locales"
                  :default-locale="defaultLocaleCode"
                  v-model:locale-filter="localeFilter"
                  @dirty-change="(val) => (formDirty = val)"
                  @submit="handleSubmit"
                  @save-draft="handleDraft"
                  @publish="confirmPublishEntry"
                />
              </div>
            </div>
          </ElTabPane>
        </ElTabs>
      </div>
      <div v-else class="error-state">
        <p>{{ errorMessage ?? t("contents.edit.error_fetch_message") }}</p>
      </div>
    </div>
  </div>

  <Dialog
    v-model:visible="backRefDialogVisible"
    modal
    :draggable="false"
    :header="backRefDialogMode === 'delete' ? t('contents.edit.delete_blocked_title') : t('contents.edit.references_dialog_title')"
    :style="{ width: '44rem' }"
  >
    <div v-if="backRefLoading" class="loading-state">
      <p>{{ t("common.loading") }}</p>
    </div>
    <div v-else>
      <div v-if="backRefRelations.length === 0 && backRefRichText.length === 0" class="empty-state">
        {{ t("contents.edit.references_empty") }}
      </div>
      <template v-else>
        <p v-if="backRefDialogMode === 'delete'" class="delete-reference-warning">
          {{ t("contents.edit.delete_blocked_message") }}
        </p>
        <h4 class="ref-section-title">{{ t("contents.edit.references_section_relations") }}</h4>
        <ElTable v-if="backRefRelations.length" :data="paginatedBackRefRelations" row-key="entryId" class="references-table" size="small" stripe>
          <ElTableColumn :label="t('contents.edit.references_table_model')" prop="modelName" style="width: 30%" />
          <!-- @vue-generic {EntryBackReference} -->
          <ElTableColumn :label="t('contents.edit.references_table_title')" style="width: 40%">
            <template #default="slotProps">
              <button class="link-button" type="button" @click="navigateToReference(slotProps.row)">
                {{ slotProps.row.displayTitle }}
              </button>
              <div class="subtext">ID: {{ slotProps.row.entryId }}</div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('contents.edit.references_table_field')" style="width: 20%">
            <template #default="slotProps">
              <div class="field-text">
                <span class="field-name">{{ slotProps.row.fieldName }}</span>
                <span class="subtext">{{ slotProps.row.fieldKey }}</span>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('contents.edit.references_table_status')" style="width: 10%">
            <template #default="slotProps">
              <Tag :value="t(`contents.entries.status_${slotProps.row.status}`)" />
            </template>
          </ElTableColumn>
        </ElTable>
        <ElPagination
          v-if="backRefRelations.length > relationPageSize"
          v-model:current-page="relationPage"
          v-model:page-size="relationPageSize"
          :page-sizes="referenceRowsPerPageOptions"
          :total="backRefRelations.length"
          layout="total, sizes, prev, pager, next"
        />
        <p v-else class="subtext muted">{{ t("contents.edit.references_empty_relations") }}</p>

        <h4 class="ref-section-title">{{ t("contents.edit.references_section_rich_text") }}</h4>
        <ElTable v-if="backRefRichText.length" :data="paginatedBackRefRichText" row-key="entryId" class="references-table" size="small" stripe>
          <ElTableColumn :label="t('contents.edit.references_table_model')" prop="modelName" style="width: 30%" />
          <!-- @vue-generic {EntryBackReference} -->
          <ElTableColumn :label="t('contents.edit.references_table_title')" style="width: 40%">
            <template #default="slotProps">
              <button class="link-button" type="button" @click="navigateToReference(slotProps.row)">
                {{ slotProps.row.displayTitle }}
              </button>
              <div class="subtext">ID: {{ slotProps.row.entryId }}</div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('contents.edit.references_table_field')" style="width: 20%">
            <template #default="slotProps">
              <div class="field-text">
                <span class="field-name">{{ slotProps.row.fieldName }}</span>
                <span class="subtext">{{ slotProps.row.fieldKey }}</span>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('contents.edit.references_table_status')" style="width: 10%">
            <template #default="slotProps">
              <Tag :value="t(`contents.entries.status_${slotProps.row.status}`)" />
            </template>
          </ElTableColumn>
        </ElTable>
        <ElPagination
          v-if="backRefRichText.length > richTextPageSize"
          v-model:current-page="richTextPage"
          v-model:page-size="richTextPageSize"
          :page-sizes="referenceRowsPerPageOptions"
          :total="backRefRichText.length"
          layout="total, sizes, prev, pager, next"
        />
        <p v-else class="subtext muted">{{ t("contents.edit.references_empty_rich_text") }}</p>
      </template>
    </div>

    <template #footer>
      <Button severity="secondary" :label="t('common.close')" @click="backRefDialogVisible = false" />
      <Button
        v-if="backRefDialogMode === 'delete' && hasBackReferences"
        severity="danger"
        icon="lucide:unlink"
        :loading="deletingEntry"
        :label="t('contents.edit.delete_detach_button')"
        @click="confirmDeleteWithDetachedReferences"
      />
    </template>
  </Dialog>
</template>

<style lang="scss" scoped>
.entry-edit-page {
  padding: var(--space-24);

  .title-info {
    .status-chips {
      display: flex;
      gap: var(--space-8);
      margin-bottom: var(--space-8);

      .status-chip {
        display: inline-flex;
        align-items: center;
        padding: 0 var(--space-8);
        height: 1.75rem;
        border-radius: 999px;
        font-size: var(--font-12);
        font-weight: 600;
        text-transform: uppercase;
        background: var(--surface-100);
        color: var(--surface-700);

        &.published {
          background: var(--green-100);
          color: var(--green-700);
        }

        &.draft {
          background: var(--yellow-100);
          color: var(--yellow-800);
        }

        &.archived {
          background: var(--surface-200);
          color: var(--surface-600);
        }
      }
    }

    .meta-info {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);
      font-size: var(--font-14);
      color: var(--surface-500);

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--space-8) var(--space-16);
        align-items: center;
      }

      .meta-item {
        display: flex;
        align-items: baseline;
        gap: var(--space-4);
        min-width: 0;
        white-space: nowrap;
      }

      .meta-label {
        flex: 0 0 auto;
        font-weight: 600;
        color: var(--surface-500);
      }

      .meta-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--surface-700);
      }

      @media (max-width: 640px) {
        .meta-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 420px) {
        .meta-grid {
          grid-template-columns: 1fr;
        }
      }

      .meta-actions {
        align-self: flex-start;
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        gap: var(--space-8);
        flex-wrap: nowrap;

        :deep(.el-button) {
          flex: 0 0 auto;
          width: auto;
          white-space: nowrap;
        }
      }
    }
  }

  .loading-state {
    text-align: center;
    padding: var(--space-32) 0;

    p {
      color: var(--surface-500);
    }
  }

  .error-state {
    text-align: center;
    padding: var(--space-32) 0;

    p {
      color: var(--red-400);
    }
  }

  .form-container {
    max-width: 64rem;
  }

  .tab-panel-content {
    margin-top: var(--space-16);
  }

  .readonly-form {
    position: relative;
  }

  .readonly-overlay {
    position: absolute;
    inset: 0;
    background: rgb(var(--surface-0-rgb) / 0.6);
    border-radius: var(--radius-2);
    pointer-events: none;
  }
}

.references-table {
  .link-button {
    background: none;
    border: none;
    color: var(--primary-600);
    cursor: pointer;
    padding: 0;
    font-weight: 600;

    &:hover {
      text-decoration: underline;
    }
  }

  .field-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .subtext {
    color: var(--surface-500);
    font-size: 0.85rem;
  }
}

.delete-reference-warning {
  margin: 0 0 var(--space-16);
  padding: var(--space-12);
  border: 1px solid var(--red-200);
  border-radius: var(--radius-2);
  background: var(--red-50);
  color: var(--red-700);
  font-size: var(--font-14);
  line-height: 1.6;
}

.ref-section-title {
  margin: var(--space-12) 0 var(--space-8);
  font-size: var(--font-14);
  font-weight: 700;
  color: var(--surface-700);
}

.history-card {
  margin-top: 0;
  margin-bottom: var(--space-16);
  padding: var(--space-16);
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-2);
  background: linear-gradient(180deg, rgb(var(--surface-100-rgb) / 0.92), var(--surface-0));
  box-shadow: none;

  .history-subtext {
    margin: 0;
    margin-bottom: var(--space-12);
    color: var(--surface-500);
    font-size: var(--font-14);
  }

  .revision-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .revision-item {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-12);
    border: 1px solid var(--surface-200);
    border-radius: var(--radius-2);
    background: var(--surface-0);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;

    &.current {
      border-color: var(--primary-200);
      box-shadow: none;
    }
  }

  .revision-body {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-8);
    cursor: pointer;
  }

  .revision-date {
    font-weight: 700;
    color: var(--surface-800);
  }

  .revision-meta {
    display: flex;
    gap: var(--space-8);
    align-items: center;
    flex-wrap: wrap;
  }

  .history-footer {
    margin-top: var(--space-12);
    display: flex;
    align-items: center;
    gap: var(--space-12);

    .restore-button {
      flex-shrink: 0;
    }

    .history-note {
      color: var(--surface-500);
      font-size: var(--font-13);
    }
  }

  .history-loading,
  .history-empty {
    padding: var(--space-8) 0;
    color: var(--surface-500);
  }
}

.workflow-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-12);
  margin-bottom: var(--space-16);
  flex-wrap: wrap;

  .action-buttons {
    display: flex;
    gap: var(--space-12);
    flex-wrap: wrap;
  }

  .action-note {
    color: var(--surface-500);
    font-size: var(--font-14);
  }

  .danger-actions {
    display: flex;
    justify-content: flex-end;
    margin-left: auto;

    .delete-entry-button {
      flex: 0 0 auto;
    }
  }
}
</style>

<style scoped>
.embedded .workflow-actions {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-0);
  padding: var(--space-12) 0;
  border-bottom: 1px solid var(--card-border);
}
</style>
