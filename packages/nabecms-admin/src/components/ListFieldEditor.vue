<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ListItemType } from "@/components/entry-form-shared";

import Button from "@/components/NabeButton.vue";
import { Checkbox } from "@/components/ui/element-plus";
import { DatePicker } from "@/components/ui/element-plus";
import { InputNumber } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";

type ListEditorItem = string | number | boolean | null;
type DatePickerValue = Date | Date[] | (Date | null)[] | null | undefined;

const model = defineModel<unknown>({ required: true });

const {
  idBase,
  itemType,
  disabled = false,
} = defineProps<{
  idBase: string;
  itemType: ListItemType;
  disabled?: boolean;
}>();

const { t } = useI18n();

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u;

/** Build the empty editor value for a list item type. */
const emptyItemForType = (type: ListItemType): ListEditorItem => {
  if (type === "number" || type === "date") return null;
  if (type === "boolean") return false;
  return "";
};

/** Convert an arbitrary stored item into an editor-safe item value. */
const toEditableItem = (type: ListItemType, value: unknown): ListEditorItem => {
  switch (type) {
    case "text":
      return typeof value === "string" ? value : value == null ? "" : String(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "date":
      return typeof value === "string" && dateOnlyPattern.test(value) ? value : null;
    case "boolean":
      return typeof value === "boolean" ? value : false;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
};

/** Resolve the current rows shown by the editor. */
const rows = computed<ListEditorItem[]>(() => {
  const values = Array.isArray(model.value) ? model.value : [];
  const normalized = values.map((item) => toEditableItem(itemType, item));
  return normalized.length > 0 ? normalized : [emptyItemForType(itemType)];
});

/** Build a stable DOM id for a list row. */
const rowId = (index: number): string => `${idBase}-${index}`;

/** Commit the full row list back to the parent form. */
const commitRows = (nextRows: ListEditorItem[]) => {
  model.value = nextRows;
};

/** Update one row without changing the others. */
const updateRow = (index: number, value: ListEditorItem) => {
  const nextRows = [...rows.value];
  nextRows[index] = value;
  commitRows(nextRows);
};

/** Append a new empty row for the configured item type. */
const addRow = () => {
  commitRows([...rows.value, emptyItemForType(itemType)]);
};

/** Remove a row and let the display fallback render one empty row when the list is empty. */
const removeRow = (index: number) => {
  const nextRows = rows.value.filter((_, rowIndex) => rowIndex !== index);
  commitRows(nextRows);
};

/** Convert a valid date-only string to the DatePicker model value. */
const toDatePickerValue = (value: ListEditorItem): Date | null => {
  if (typeof value !== "string" || !dateOnlyPattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Convert a DatePicker payload into the saved date-only string. */
const toDateOnlyValue = (value: DatePickerValue): string | null => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime())) return null;
  return candidate.toISOString().slice(0, 10);
};

/** Update one date row from the date picker payload. */
const updateDateRow = (index: number, value: DatePickerValue) => {
  updateRow(index, toDateOnlyValue(value));
};
</script>

<template>
  <div class="list-field-editor">
    <div class="list-field-editor__rows">
      <div v-for="(item, index) in rows" :key="rowId(index)" class="list-field-editor__row">
        <InputText
          v-if="itemType === 'text'"
          :id="rowId(index)"
          :modelValue="typeof item === 'string' ? item : ''"
          :disabled="disabled"
          fluid
          @update:modelValue="(value: string | undefined) => updateRow(index, value ?? '')"
        />

        <InputNumber
          v-else-if="itemType === 'number'"
          :id="rowId(index)"
          :inputId="rowId(index)"
          :modelValue="typeof item === 'number' ? item : null"
          :disabled="disabled"
          :useGrouping="false"
          fluid
          @update:modelValue="(value: number | null) => updateRow(index, value)"
        />

        <DatePicker
          v-else-if="itemType === 'date'"
          :id="rowId(index)"
          :inputId="rowId(index)"
          :modelValue="toDatePickerValue(item)"
          :disabled="disabled"
          dateFormat="yy/mm/dd"
          showIcon
          fluid
          @update:modelValue="(value: DatePickerValue) => updateDateRow(index, value)"
        />

        <div v-else class="list-field-editor__boolean">
          <Checkbox
            :inputId="rowId(index)"
            :modelValue="Boolean(item)"
            :disabled="disabled"
            binary
            @update:modelValue="(value: boolean) => updateRow(index, value)"
          />
          <label :for="rowId(index)">{{ Boolean(item) ? t("common.yes") : t("common.no") }}</label>
        </div>

        <Button
          v-if="!disabled"
          type="button"
          icon="lucide:trash-2"
          severity="secondary"
          text
          size="small"
          :aria-label="t('common.delete')"
          @click="removeRow(index)"
        />
      </div>
    </div>

    <div v-if="!disabled" class="list-field-editor__actions">
      <Button type="button" icon="lucide:plus" size="small" :label="t('models.detail.add_field_dialog.add')" @click="addRow" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.list-field-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.list-field-editor__rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.list-field-editor__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-8);
  align-items: flex-start;
}

.list-field-editor__boolean {
  min-height: 2.5rem;
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  color: var(--surface-900);
}

.list-field-editor__actions {
  display: flex;
  justify-content: flex-start;
}
</style>
