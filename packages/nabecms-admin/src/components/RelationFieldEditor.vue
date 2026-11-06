<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useReferenceSession } from "@/pages/contents/entry-edit/referenceSession";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { getCachedEntryReference, loadEntryReference } from "@/services/entryReferences";
import { formatLocalizedDateTimeParts } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import RelationEntryCreateDialog from "@/components/RelationEntryCreateDialog.vue";
import { ElPagination, ElTable, ElTableColumn } from "element-plus";
import { Checkbox, Dialog, InputText, RadioButton, Select } from "@/components/ui/element-plus";
type RelationType = "one" | "many";

type RelationValue = {
  type: RelationType;
  entryIds: string[];
};

type ModelOption = {
  label: string;
  value: string;
};

type LocaleOption = {
  code: string;
  isDefault?: boolean;
};

type EntrySummary = {
  id: string;
  displayTitle: string;
  modelId: string;
  modelName: string | null;
};

type EntrySearchResult = {
  id: string;
  modelId: string;
  displayTitle: string;
  status: string;
  updatedAt: string | null;
};

type RelationEntryCreatedPayload = {
  id: string;
  modelId: string;
  status: string;
  updatedAt: string | null;
};

const props = withDefaults(
  defineProps<{
    modelValue: RelationValue | null | undefined;
    variant: RelationType;
    allowedModelIds: string[];
    disabled?: boolean;
    locales?: LocaleOption[];
    defaultLocale?: string;
    localeFilter?: string;
  }>(),
  {
    disabled: false,
    locales: () => [],
    defaultLocale: "en",
    localeFilter: "all",
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: RelationValue | null): void;
}>();

const { t } = useI18n();
const authStore = useAuthStore();
const referenceSession = useReferenceSession();
const router = useRouter();
const openEntry = (entry: EntrySummary) => {
  if (!entry.modelId) return;
  const target = { entryId: entry.id, modelId: entry.modelId, title: entry.displayTitle, modelName: entry.modelName ?? undefined };
  if (referenceSession) referenceSession.open(target);
  else void router.push(`/contents/${encodeResourceId(entry.modelId)}/${encodeResourceId(entry.id)}`);
};

const metadataLoading = ref(false);
const metadataError = ref<string | null>(null);
const selectedEntries = ref<EntrySummary[]>([]);
const currentIds = ref<string[]>([]);

const dialogVisible = ref(false);
const modelsLoading = ref(false);
const modelsError = ref<string | null>(null);
const modelOptions = ref<ModelOption[]>([]);
const selectedModelId = ref<string | null>(null);
const searchQuery = ref("");
const entriesLoading = ref(false);
const entriesError = ref<string | null>(null);
const entryResults = ref<EntrySearchResult[]>([]);
const singleSelection = ref<EntrySearchResult | null>(null);
const multipleSelection = ref<EntrySearchResult[]>([]);
const createDialogVisible = ref(false);
const createDialogModelId = ref<string | null>(null);

const currentPage = ref(1);
const pageSize = ref(10);
const paginatedEntryResults = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return entryResults.value.slice(start, start + pageSize.value);
});

/** Format a relation timestamp as separate display lines for its date and time. */
const formatDateTimeLines = (value: string | null): string[] => {
  if (!value) return ["-"];
  const { date, time } = formatLocalizedDateTimeParts(value);
  return [date, time].filter((line) => line.length > 0);
};

const hasConfiguration = computed(() => props.allowedModelIds.length > 0);

const allowedOptions = computed<ModelOption[]>(() => {
  if (props.allowedModelIds.length === 0) return modelOptions.value;
  const map = new Map(modelOptions.value.map((option) => [option.value, option.label] as const));
  return props.allowedModelIds.map((id) => ({ value: id, label: map.get(id) ?? id }) satisfies ModelOption);
});

const isManyVariant = computed(() => props.variant === "many");

const createDialogModelName = computed(() => {
  const modelId = createDialogModelId.value;
  if (!modelId) return null;
  return allowedOptions.value.find((option) => option.value === modelId)?.label ?? modelId;
});

const canCreateEntryFromEmptyState = computed(() => !props.disabled && !!selectedModelId.value);

const reorderSelectedEntries = (ids: readonly string[], current: readonly EntrySummary[]): EntrySummary[] => {
  const map = new Map(current.map((entry) => [entry.id, entry] as const));
  return ids.map((id) => map.get(id) ?? ({ id, displayTitle: id, modelId: "", modelName: null } satisfies EntrySummary));
};

const dialogStyle = { width: "52rem" } as const;
const dialogBreakpoints: Record<string, string> = {
  "1400px": "48rem",
  "1200px": "44rem",
  "992px": "38rem",
  "768px": "90vw",
  "576px": "95vw",
};

const canConfirmSelection = computed(() => {
  if (props.disabled) return false;
  if (props.variant === "one") {
    return !!singleSelection.value;
  }
  if (multipleSelection.value.length === 0) return false;
  return true;
});

let metadataToken = 0;

const normalizeIds = (value: RelationValue | null | undefined): string[] => {
  if (!value || typeof value !== "object") return [];
  if (!Array.isArray(value.entryIds)) return [];
  const ids = value.entryIds
    .map((id) => (typeof id === "string" ? id : String(id ?? "")))
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (props.variant === "one") return ids.slice(0, 1);
  return Array.from(new Set(ids));
};

const syncSelectionFromValue = async (value: RelationValue | null | undefined) => {
  const ids = normalizeIds(value);
  currentIds.value = ids;
  const token = ++metadataToken;
  if (ids.length === 0) {
    selectedEntries.value = [];
    metadataError.value = null;
    metadataLoading.value = false;
    return;
  }
  metadataLoading.value = true;
  metadataError.value = null;
  const summaries: EntrySummary[] = [];
  for (const id of ids) {
    const cached = getCachedEntryReference(id);
    if (cached) {
      summaries.push({
        id,
        displayTitle: cached.displayTitle ?? id,
        modelId: cached.modelId,
        modelName: cached.modelName ?? null,
      });
      continue;
    }
    try {
      const meta = await loadEntryReference(id);
      if (metadataToken !== token) return;
      summaries.push({
        id,
        displayTitle: meta.displayTitle ?? id,
        modelId: meta.modelId,
        modelName: meta.modelName ?? null,
      });
    } catch (error) {
      if (metadataToken !== token) return;
      console.error("Failed to load entry reference:", error);
      metadataError.value = t("contents.fields.relation.metadata_error");
      summaries.push({ id, displayTitle: id, modelId: "", modelName: null });
    }
  }
  if (metadataToken !== token) return;
  selectedEntries.value = summaries;
  metadataLoading.value = false;
};

watch(
  () => props.modelValue,
  (value) => {
    syncSelectionFromValue(value);
  },
  { deep: true, immediate: true },
);

watch(
  () => [...props.allowedModelIds],
  (ids) => {
    if (ids.length === 0) {
      selectedModelId.value = null;
      return;
    }
    if (!ids.includes(selectedModelId.value ?? "")) {
      selectedModelId.value = ids[0] ?? null;
    }
  },
  { immediate: true },
);

const ensureAuth = async () => {
  if (!authStore.accessToken) {
    await authStore.refresh().catch(() => undefined);
  }
};

/** Returns whether a model id is available for the current relation field. */
const isAllowedModelId = (modelId: string): boolean => props.allowedModelIds.length === 0 || props.allowedModelIds.includes(modelId);

const ensureModelOptions = async () => {
  if (modelOptions.value.length > 0 || modelsLoading.value) return;
  modelsLoading.value = true;
  modelsError.value = null;
  try {
    await ensureAuth();
    const res = await authorizedFetch(authStore, "/api/admin/models");
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || res.statusText);
    }
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    modelOptions.value = items.map((item: Record<string, unknown>) => {
      const id = typeof item.id === "string" ? item.id : String(item.id ?? "");
      const name = typeof item.name === "string" && item.name.trim().length > 0 ? item.name : id;
      return { value: id, label: name } satisfies ModelOption;
    });
  } catch (error) {
    console.error("Failed to fetch relation models:", error);
    modelsError.value = t("contents.fields.relation.models_error");
  } finally {
    modelsLoading.value = false;
  }
};

const searchEntries = async () => {
  const modelId = selectedModelId.value;
  if (!modelId) {
    entriesError.value = t("contents.fields.relation.select_model");
    entryResults.value = [];
    return;
  }
  if (!isAllowedModelId(modelId)) {
    entriesError.value = t("contents.fields.relation.model_not_allowed");
    entryResults.value = [];
    return;
  }
  entriesLoading.value = true;
  entriesError.value = null;
  try {
    await ensureAuth();
    const query = searchQuery.value.trim();
    const suffix = query.length > 0 ? `?q=${encodeURIComponent(query)}` : "";
    const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/entries${suffix}`);
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || res.statusText);
    }
    const data = await res.json();
    entryResults.value = (Array.isArray(data) ? data : []).map((item: Record<string, unknown>) => {
      const id = typeof item.id === "string" ? item.id : String(item.id ?? "");
      const displayTitle = typeof item.displayTitle === "string" && item.displayTitle.trim().length > 0 ? item.displayTitle : id;
      const status = typeof item.status === "string" ? item.status : "";
      const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : null;
      const modelIdValue = typeof item.modelId === "string" ? item.modelId : modelId;
      return { id, displayTitle, status, updatedAt, modelId: modelIdValue } satisfies EntrySearchResult;
    });
    currentPage.value = 1;
  } catch (error) {
    console.error("Failed to search relation entries:", error);
    entriesError.value = t("contents.fields.relation.search_error");
    entryResults.value = [];
  } finally {
    entriesLoading.value = false;
  }
};

/** Opens the nested entry editor for the currently selected relation model. */
const openCreateDialog = () => {
  if (props.disabled) return;
  const modelId = selectedModelId.value ?? allowedOptions.value[0]?.value ?? modelOptions.value[0]?.value ?? null;
  if (!modelId || !isAllowedModelId(modelId)) return;
  selectedModelId.value = modelId;
  createDialogModelId.value = modelId;
  createDialogVisible.value = true;
};

/** Adds or replaces a freshly created entry in the current search result set. */
const upsertEntryResult = (entry: EntrySearchResult): void => {
  entryResults.value = [entry, ...entryResults.value.filter((item) => item.id !== entry.id)];
};

/** Selects a created entry according to the relation variant. */
const selectCreatedEntry = (entry: EntrySearchResult): void => {
  if (props.variant === "one") {
    singleSelection.value = entry;
    return;
  }
  if (multipleSelection.value.some((item) => item.id === entry.id)) return;
  multipleSelection.value = [...multipleSelection.value, entry];
};

/** Toggle a row while retaining selections made on other pages. */
const toggleMultipleSelection = (entry: EntrySearchResult, selected: boolean): void => {
  multipleSelection.value = selected
    ? [...multipleSelection.value.filter((item) => item.id !== entry.id), entry]
    : multipleSelection.value.filter((item) => item.id !== entry.id);
};

/** Handles a related entry created inside the nested dialog and prepares it for confirmation. */
const handleCreatedEntry = async (entry: RelationEntryCreatedPayload): Promise<void> => {
  const modelId = entry.modelId || createDialogModelId.value || selectedModelId.value;
  if (!entry.id || !modelId) return;
  if (!selectedModelId.value) selectedModelId.value = modelId;

  let displayTitle = entry.id;
  try {
    const meta = await loadEntryReference(entry.id);
    displayTitle = meta.displayTitle ?? entry.id;
  } catch (error) {
    console.error("Failed to load created relation entry reference:", error);
  }

  const createdEntry = {
    id: entry.id,
    modelId,
    displayTitle,
    status: entry.status,
    updatedAt: entry.updatedAt,
  } satisfies EntrySearchResult;

  entriesError.value = null;
  upsertEntryResult(createdEntry);
  selectCreatedEntry(createdEntry);
  createDialogModelId.value = null;
};

watch(selectedModelId, async (modelId, prevModelId) => {
  if (!dialogVisible.value) return;
  if (modelId === prevModelId) return;
  singleSelection.value = null;
  multipleSelection.value = [];
  await searchEntries();
});

const applyIds = (ids: string[]) => {
  const normalized = props.variant === "one" ? ids.slice(0, 1) : Array.from(new Set(ids));
  currentIds.value = normalized;
  selectedEntries.value = reorderSelectedEntries(normalized, selectedEntries.value);
  if (normalized.length === 0) {
    emit("update:modelValue", null);
    selectedEntries.value = [];
    return;
  }
  emit("update:modelValue", { type: props.variant, entryIds: normalized });
  syncSelectionFromValue({ type: props.variant, entryIds: normalized });
};

const handleRemove = (id: string) => {
  if (props.disabled) return;
  applyIds(currentIds.value.filter((candidate) => candidate !== id));
};

const openDialog = async () => {
  if (props.disabled || !hasConfiguration.value) return;
  await ensureModelOptions();
  if (!selectedModelId.value) {
    selectedModelId.value = allowedOptions.value[0]?.value ?? modelOptions.value[0]?.value ?? null;
  }
  dialogVisible.value = true;
  await nextTick();
  await searchEntries();
  if (props.variant === "one") {
    const initialId = currentIds.value[0];
    singleSelection.value = entryResults.value.find((item) => item.id === initialId) ?? null;
  } else {
    const set = new Set(currentIds.value);
    multipleSelection.value = entryResults.value.filter((item) => set.has(item.id));
  }
};

const closeDialog = () => {
  dialogVisible.value = false;
  entriesError.value = null;
  entriesLoading.value = false;
  singleSelection.value = null;
  multipleSelection.value = [];
};

const confirmSelection = () => {
  if (props.variant === "one") {
    const id = singleSelection.value?.id;
    applyIds(id ? [id] : []);
    closeDialog();
    return;
  }
  const merged = [...currentIds.value];
  for (const item of multipleSelection.value) {
    if (!merged.includes(item.id)) merged.push(item.id);
  }
  applyIds(merged);
  closeDialog();
};

const moveEntry = (id: string, direction: "up" | "down") => {
  if (!isManyVariant.value || props.disabled) return;
  const next = [...currentIds.value];
  const index = next.indexOf(id);
  if (index === -1) return;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return;
  const [removed] = next.splice(index, 1);
  if (removed === undefined) return;
  next.splice(target, 0, removed);
  applyIds(next);
};
</script>

<template>
  <div class="relation-field">
    <div class="relation-header">
      <Button
        data-test="relation-open"
        type="button"
        icon="lucide:plus"
        :label="t('contents.fields.relation.confirm_button')"
        :disabled="disabled || !hasConfiguration"
        @click="openDialog"
      />
    </div>

    <p v-if="!hasConfiguration" class="relation-hint relation-hint--error">
      {{ t("contents.fields.relation.no_models_configured") }}
    </p>

    <div v-if="metadataError" class="relation-hint relation-hint--error">{{ metadataError }}</div>

    <div v-if="selectedEntries.length === 0 && currentIds.length === 0" class="relation-empty">
      <span>{{ t("contents.fields.relation.empty") }}</span>
    </div>

    <div v-else class="relation-selected">
      <div v-for="entry in selectedEntries" :key="entry.id" class="relation-chip">
        <div v-if="isManyVariant" class="relation-chip__reorder">
          <Button data-test="relation-move-up" icon="lucide:chevron-up" text rounded size="small" :disabled="disabled" @click="moveEntry(entry.id, 'up')" />
          <Button
            data-test="relation-move-down"
            icon="lucide:chevron-down"
            text
            rounded
            size="small"
            :disabled="disabled"
            @click="moveEntry(entry.id, 'down')"
          />
        </div>
        <div class="relation-chip__labels">
          <span class="relation-chip__title">{{ getCachedEntryReference(entry.id)?.displayTitle ?? entry.displayTitle }}</span>
          <span v-if="getCachedEntryReference(entry.id)?.status" class="entry-status">{{
            t(`contents.entries.status_${getCachedEntryReference(entry.id)?.status}`)
          }}</span>
          <span class="relation-chip__meta">#{{ entry.id }} · {{ entry.modelName ?? entry.modelId }}</span>
        </div>
        <Button
          v-if="entry.modelId"
          data-test="relation-edit"
          type="button"
          severity="secondary"
          icon="lucide:arrow-right"
          :disabled="referenceSession?.busy.value"
          :label="
            t(
              referenceSession?.isOpen({ modelId: entry.modelId, entryId: entry.id })
                ? 'contents.reference_editor.return_open'
                : 'contents.reference_editor.open',
            )
          "
          @click="openEntry(entry)"
        />
        <Button
          class="relation-chip__remove"
          data-test="relation-remove"
          type="button"
          icon="lucide:x"
          text
          severity="secondary"
          :disabled="disabled"
          :aria-label="t('contents.fields.relation.remove_button')"
          @click="handleRemove(entry.id)"
        />
      </div>
    </div>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :header="t('contents.fields.relation.dialog_title')"
      :draggable="false"
      class="relation-dialog"
      :style="dialogStyle"
      :breakpoints="dialogBreakpoints"
      @hide="closeDialog"
    >
      <div class="dialog-content">
        <div class="dialog-field">
          <label class="dialog-label">{{ t("contents.fields.relation.model_label") }}</label>
          <Select
            v-model="selectedModelId"
            :options="allowedOptions"
            optionLabel="label"
            optionValue="value"
            :disabled="modelsLoading"
            :loading="modelsLoading"
            data-test="relation-model-select"
          />
          <p v-if="modelsError" class="dialog-error">{{ modelsError }}</p>
        </div>

        <div class="dialog-field">
          <label class="dialog-label">{{ t("contents.fields.relation.search_label") }}</label>
          <div class="dialog-search">
            <InputText
              v-model="searchQuery"
              class="dialog-search__input"
              :placeholder="t('contents.fields.relation.search_placeholder')"
              @keyup.enter="searchEntries"
            />
            <Button
              type="button"
              icon="lucide:search"
              :label="t('contents.fields.relation.search_button')"
              :loading="entriesLoading"
              :disabled="entriesLoading || !selectedModelId"
              @click="searchEntries"
            />
          </div>
          <p v-if="entriesError" class="dialog-error">{{ entriesError }}</p>
        </div>

        <div v-if="entriesLoading" class="dialog-loading">{{ t("contents.fields.relation.loading") }}</div>
        <template v-else>
          <ElTable v-if="props.variant === 'one'" :data="paginatedEntryResults" row-key="id" class="relation-table" size="small" stripe>
            <!-- @vue-generic {EntrySearchResult} -->
            <ElTableColumn width="48" align="center">
              <template #default="{ row }">
                <RadioButton
                  :model-value="singleSelection?.id ?? null"
                  :value="row.id"
                  :data-row-id="row.id"
                  :aria-label="row.displayTitle"
                  @update:model-value="singleSelection = row"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn prop="displayTitle" :label="t('contents.fields.relation.table_title')" :min-width="240">
              <template #default="{ row: data }">
                <div class="dialog-option">
                  <span class="dialog-option__title">{{ data.displayTitle }}</span>
                  <span class="dialog-option__meta">#{{ data.id }} · {{ data.status || "-" }}</span>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="modelId" :label="t('contents.fields.relation.table_model')" width="176" />
            <ElTableColumn prop="updatedAt" :label="t('contents.fields.relation.table_updated')" width="176">
              <template #default="{ row: data }">
                <time class="dialog-date-time" :datetime="data.updatedAt ?? undefined">
                  <span v-for="line in formatDateTimeLines(data.updatedAt)" :key="line" class="dialog-date-time__line">{{ line }}</span>
                </time>
              </template>
            </ElTableColumn>
            <template #empty>
              <div class="dialog-empty">
                <p>{{ t("contents.fields.relation.empty_results") }}</p>
                <Button
                  data-test="relation-empty-create-open"
                  type="button"
                  icon="lucide:plus"
                  severity="secondary"
                  size="small"
                  :label="t('contents.fields.relation.create_button')"
                  :disabled="!canCreateEntryFromEmptyState"
                  @click="openCreateDialog"
                />
              </div>
            </template>
          </ElTable>

          <ElTable v-else :data="paginatedEntryResults" row-key="id" class="relation-table" size="small" stripe>
            <!-- @vue-generic {EntrySearchResult} -->
            <ElTableColumn width="48" align="center">
              <template #default="{ row }">
                <Checkbox
                  :model-value="multipleSelection.some((item) => item.id === row.id)"
                  :data-row-id="row.id"
                  :aria-label="row.displayTitle"
                  @update:model-value="(selected: boolean) => toggleMultipleSelection(row, selected)"
                />
              </template>
            </ElTableColumn>
            <ElTableColumn prop="displayTitle" :label="t('contents.fields.relation.table_title')" :min-width="240">
              <template #default="{ row: data }">
                <div class="dialog-option">
                  <span class="dialog-option__title">{{ data.displayTitle }}</span>
                  <span class="dialog-option__meta">#{{ data.id }} · {{ data.status || "-" }}</span>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn prop="modelId" :label="t('contents.fields.relation.table_model')" width="144" />
            <ElTableColumn prop="updatedAt" :label="t('contents.fields.relation.table_updated')" width="176">
              <template #default="{ row: data }">
                <time class="dialog-date-time" :datetime="data.updatedAt ?? undefined">
                  <span v-for="line in formatDateTimeLines(data.updatedAt)" :key="line" class="dialog-date-time__line">{{ line }}</span>
                </time>
              </template>
            </ElTableColumn>
            <template #empty>
              <div class="dialog-empty">
                <p>{{ t("contents.fields.relation.empty_results") }}</p>
                <Button
                  data-test="relation-empty-create-open"
                  type="button"
                  icon="lucide:plus"
                  severity="secondary"
                  size="small"
                  :label="t('contents.fields.relation.create_button')"
                  :disabled="!canCreateEntryFromEmptyState"
                  @click="openCreateDialog"
                />
              </div>
            </template>
          </ElTable>
          <ElPagination
            v-if="entryResults.length > 0"
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="entryResults.length"
            layout="total, sizes, prev, pager, next"
            class="relation-pagination"
          />
        </template>
      </div>

      <template #footer>
        <div class="dialog-actions">
          <Button type="button" severity="secondary" :label="t('contents.fields.relation.cancel_button')" @click="closeDialog" />
          <Button
            data-test="relation-apply"
            type="button"
            icon="lucide:plus"
            :label="t('contents.fields.relation.confirm_button')"
            :disabled="!canConfirmSelection"
            @click="confirmSelection"
          />
        </div>
      </template>
    </Dialog>

    <RelationEntryCreateDialog
      v-model:visible="createDialogVisible"
      :model-id="createDialogModelId"
      :model-name="createDialogModelName"
      :locales="locales"
      :default-locale="defaultLocale"
      :locale-filter="localeFilter"
      @created="handleCreatedEntry"
    />
  </div>
</template>

<style lang="scss" scoped>
.relation-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  .relation-header {
    display: flex;
    gap: var(--space-8);
  }

  .relation-empty {
    font-size: var(--font-14);
    color: var(--surface-500);
  }

  .relation-selected {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .relation-chip {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-12);
    padding: var(--space-12);
    border: 1px solid var(--surface-200);
    border-radius: var(--radius-2);
    background-color: var(--surface-0);

    &__labels {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      gap: var(--space-4);
      min-inline-size: 0;
    }

    &__title {
      font-weight: 600;
      color: var(--surface-800);
      overflow-wrap: anywhere;
    }

    &__meta {
      font-size: var(--font-12);
      color: var(--surface-500);
      overflow-wrap: anywhere;
    }

    &__remove {
      flex: 0 0 auto;
      margin-inline-start: auto;
    }

    &__reorder {
      display: flex;
      flex: 0 0 auto;
      flex-direction: column;
      gap: var(--space-4);
    }
  }

  .relation-hint {
    font-size: var(--font-12);

    &--warn {
      color: var(--orange-500);
    }

    &--info {
      color: var(--primary-color);
    }

    &--error {
      color: var(--red-500);
    }
  }

  &__reorder {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-4);
  }
}

.relation-dialog {
  :deep(.el-dialog__body) {
    padding-top: var(--space-16);
  }
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.dialog-label {
  font-weight: 600;
  color: var(--surface-700);
}

.dialog-search {
  display: flex;
  gap: var(--space-8);

  &__input {
    flex: 1 1 auto;
  }
}

.dialog-error {
  font-size: var(--font-12);
  color: var(--red-500);
}

.dialog-loading {
  font-size: var(--font-14);
  color: var(--surface-600);
}

.dialog-listbox {
  width: 100%;

  :deep(.nabe-listbox) {
    max-height: 220px;
  }
}

.relation-table {
  width: 100%;

  :deep(.el-table__header th.el-table__cell) {
    font-weight: 600;
    color: var(--surface-700);
  }
}

.relation-pagination {
  justify-content: flex-end;
}

.dialog-option {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);

  &__title {
    font-weight: 600;
    color: var(--surface-800);
  }

  &__meta {
    font-size: var(--font-12);
    color: var(--surface-500);
  }
}

.dialog-date-time {
  display: inline-flex;
  flex-direction: column;
  line-height: 1.4;
  white-space: nowrap;
}

.dialog-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-16) 0;
  font-size: var(--font-14);
  color: var(--surface-500);
  text-align: center;

  p {
    margin: 0;
  }
}

.dialog-warning {
  font-size: var(--font-12);
  color: var(--orange-500);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-8);
}
</style>
