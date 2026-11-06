<script lang="ts" setup>
import { computed, defineAsyncComponent, shallowRef, toRefs, watch } from "vue";
import { Field } from "vee-validate";
import type { Extension } from "@codemirror/state";
import { useI18n } from "vue-i18n";
import MediaPickerDialog from "@/components/MediaPickerDialog.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import ListFieldEditor from "@/components/ListFieldEditor.vue";
import {
  type EntryFormModel,
  isCodeTextField,
  isMarkdownTextField,
  resolveListItemType,
  toCodeEditorValue,
  toJsonEditorValue,
} from "@/components/entry-form-shared";
import { useEntryJsonValidation } from "@/composables/useEntryJsonValidation";
import { useEntryMediaPicker } from "@/composables/useEntryMediaPicker";
import type { ModelField } from "@/modules/entries";
import { ICONS } from "@/utils/icons";
import { SelectButton } from "@/components/ui/element-plus";

import Button from "@/components/NabeButton.vue";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { DatePicker } from "@/components/ui/element-plus";
import { InputNumber } from "@/components/ui/element-plus";
import { ToggleSwitch } from "@/components/ui/element-plus";
const CodeMirrorInput = defineAsyncComponent(() => import("@/components/CodeMirrorInput.vue"));
const MarkdownEditorField = defineAsyncComponent(() => import("@/components/MarkdownEditorField.vue"));
const RelationFieldEditor = defineAsyncComponent(() => import("@/components/RelationFieldEditor.vue"));
const RichTextEditor = defineAsyncComponent(() => import("@/components/RichTextEditor.vue"));

type RelationValue = {
  type: "one" | "many";
  entryIds: string[];
};

type RelationSettings = {
  variant: "one" | "many";
  allowedModelIds: string[];
};

type FieldLocale = string | undefined;

const props = withDefaults(
  defineProps<{
    mode: "create" | "edit";
    model: EntryFormModel;
    initialValues: Record<string, unknown>;
    loading?: boolean;
    locales?: { code: string; isDefault?: boolean }[];
    defaultLocale?: string;
    readonly?: boolean;
    inputIdPrefix?: string;
  }>(),
  {
    loading: false,
    locales: () => [],
    defaultLocale: "en",
    readonly: false,
    inputIdPrefix: "",
  },
);

const localeFilterModel = defineModel<string>("localeFilter", { default: "all" });
const { mode, model, initialValues, loading, locales, defaultLocale, readonly, inputIdPrefix } = toRefs(props);

const { t } = useI18n();

const { resetJsonErrors, buildJsonExtensions, handleJsonChange, getJsonError } = useEntryJsonValidation({
  t,
  fields: computed(() => model.value.fields),
});

watch(initialValues, () => {
  resetJsonErrors();
});

const fieldTypeLabel = (field: ModelField): string => {
  const key = `models.detail.field_types.${field.type}`;
  const translated = t(key);
  return translated !== key ? translated : field.type;
};

/** Resolve a translated variant label, falling back to the stored variant value. */
const fieldVariantLabel = (field: ModelField): string => {
  const variant = field.variant ?? "";
  if (variant.length === 0) return "";
  const key = `models.detail.add_field_dialog.variant_labels.${field.type}.${variant}`;
  const translated = t(key);
  return translated !== key ? translated : variant;
};

/** Check whether a text field should use a multi-line editor. */
const isLongTextField = (field: ModelField): boolean => field.type === "text" && field.variant === "longText";

const fieldIcon = (field: ModelField): string => {
  switch (field.type) {
    case "text":
      return ICONS.alignLeft;
    case "rich_text":
      return ICONS.fileEdit;
    case "number":
      return ICONS.number;
    case "date":
      return ICONS.calendar;
    case "boolean":
      return ICONS.boolean;
    case "media":
      return ICONS.images;
    case "relation":
      return ICONS.relation;
    case "list":
      return ICONS.list;
    case "json":
      return ICONS.code;
    default:
      return ICONS.question;
  }
};

const resolveRelationSettings = (field: ModelField): RelationSettings => {
  const variant = field.variant === "many" ? "many" : "one";
  const options = field.options && typeof field.options === "object" ? (field.options as Record<string, unknown>) : {};
  const allowedRaw = Array.isArray(options.allowedModels) ? options.allowedModels : [];
  const allowedModelIds = allowedRaw
    .map((id) => (typeof id === "string" ? id : String(id ?? "")))
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return { variant, allowedModelIds };
};

const fieldRules = (field: ModelField): string => {
  if (!field.required) return "";
  if (field.type === "rich_text") return "rich_text_required";
  if (field.type === "relation") return "relation_required";
  return "required";
};

const codeEditorExtensions = shallowRef<Extension[]>([]);
const jsonEditorExtensions = shallowRef(new Map<string, Extension[]>());

/** Load generic CodeMirror extensions only when code-like fields are actually rendered. */
const ensureCodeEditorExtensions = async () => {
  if (codeEditorExtensions.value.length > 0) return;
  const { EditorView } = await import("@codemirror/view");
  codeEditorExtensions.value = [EditorView.lineWrapping];
};

/** Load JSON CodeMirror extensions per field only when JSON editors are present. */
const syncJsonEditorExtensions = async (fields: ModelField[]) => {
  const jsonFields = fields.filter((field) => field.type === "json");
  if (jsonFields.length === 0) {
    jsonEditorExtensions.value = new Map();
    return;
  }

  const entries = await Promise.all(jsonFields.map(async (field) => [field.id, await buildJsonExtensions(field)] as const));
  jsonEditorExtensions.value = new Map(entries);
};

/** Resolve the lazily loaded JSON editor extensions for the given field. */
const getJsonEditorExtensions = (field: ModelField): Extension[] => jsonEditorExtensions.value.get(field.id) ?? [];

const castRelationValue = (value: unknown): RelationValue | null => {
  if (value && typeof value === "object") return value as RelationValue;
  return null;
};

/** Build relation editor props, including the locale context for nested entry creation. */
const relationEditorProps = (field: ModelField, value: unknown, localeCode: FieldLocale) => {
  const settings = resolveRelationSettings(field);
  return {
    modelValue: castRelationValue(value),
    variant: settings.variant,
    allowedModelIds: settings.allowedModelIds,
    locales: localeItems.value,
    defaultLocale: defaultLocaleCode.value,
    localeFilter: localeCode ?? localeFilterModel.value,
  };
};

const {
  mediaDialogVisible,
  mediaDialogSelection,
  mediaMap,
  openMediaDialog,
  handleMediaConfirm,
  mediaVariant,
  mediaAllowedKinds,
  moveMediaItem,
  parseIds,
  stringifyIds,
  activeMediaField,
} = useEntryMediaPicker({ model, initialValues });

const isInlineField = (field: ModelField): boolean => ["boolean", "number", "date"].includes(field.type);

const localeItems = computed(() => {
  const items = locales.value ?? [];
  if (items.length > 0) return items.map((item) => ({ code: item.code, isDefault: Boolean(item.isDefault) }));
  return [{ code: defaultLocale.value, isDefault: true }];
});

const defaultLocaleCode = computed(() => localeItems.value.find((item) => item.isDefault)?.code ?? localeItems.value[0]?.code ?? "en");

const orderedLocales = computed(() => {
  const codes = localeItems.value.map((item) => item.code);
  if (!codes.includes(defaultLocaleCode.value)) codes.unshift(defaultLocaleCode.value);
  return Array.from(new Set(codes));
});

const localeOptions = computed(() => {
  if (orderedLocales.value.length <= 1) return [] as Array<{ label: string; value: string }>;
  return [{ label: t("common.all"), value: "all" }, ...orderedLocales.value.map((code) => ({ label: code, value: code }))];
});

const visibleLocales = computed(() => {
  if (localeFilterModel.value === "all") return orderedLocales.value;
  return orderedLocales.value.filter((code) => code === localeFilterModel.value);
});

watch(
  () => model.value.fields,
  (fields) => {
    if (fields.some(isCodeTextField)) {
      void ensureCodeEditorExtensions();
    }
    void syncJsonEditorExtensions(fields);
  },
  { immediate: true, deep: true },
);

/** Resolve the locales to render for a field, honoring the locale filter. */
const resolveFieldLocales = (field: ModelField): FieldLocale[] => (field.hasLocales ? visibleLocales.value : [undefined]);

/** Build a stable key for per-locale rendering. */
const fieldLocaleKey = (field: ModelField, localeCode: FieldLocale): string => (localeCode ? `${field.id}-${localeCode}` : field.id);

/** Build a vee-validate field name for locale-aware fields. */
const fieldInputName = (field: ModelField, localeCode: FieldLocale): string => (localeCode ? `${field.name}.${localeCode}` : field.name);

/** Build a base input id for a field, optionally scoped by locale. */
const fieldInputId = (field: ModelField, localeCode: FieldLocale): string => `${inputIdPrefix.value}${localeCode ? `${field.name}-${localeCode}` : field.name}`;

/** Resolve the first rendered input id associated with a field label. */
const fieldLabelInputId = (field: ModelField): string => fieldInputId(field, resolveFieldLocales(field)[0]);

/** Build a unique section heading id for this form instance. */
const fieldsSectionTitleId = computed(() => `${inputIdPrefix.value}fields-section-title`);
</script>

<template>
  <section class="form-section fields-section" :aria-labelledby="fieldsSectionTitleId">
    <div class="form-section__header">
      <h2 :id="fieldsSectionTitleId">{{ t(`contents.${mode}.fields`) }}</h2>
    </div>
    <div class="form-section__content">
      <div class="fields-toolbar" v-if="localeOptions.length > 0">
        <SelectButton
          v-model="localeFilterModel"
          :options="localeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
          :disabled="loading"
          aria-label="Locale filter"
        />
      </div>
      <div class="fields-container">
        <div v-for="field in model.fields" :key="field.id" :class="['field-item', { 'inline-field': isInlineField(field) }]">
          <label :for="fieldLabelInputId(field)" class="field-label">
            <span class="field-icon" aria-hidden="true"><NabeIcon :icon="fieldIcon(field)" /></span>
            <span class="field-name">{{ field.name }}</span>
            <span class="field-type-badge">{{ fieldTypeLabel(field) }}</span>
            <span v-if="field.variant" class="field-variant-badge">{{ fieldVariantLabel(field) }}</span>
            <span v-if="field.required" class="required" aria-label="required">*</span>
            <span v-if="field.hasLocales" class="locale-badge">{{ t(`contents.${mode}.multilingual`) }}</span>
          </label>

          <div class="field-control">
            <div :class="{ 'localized-inputs': field.hasLocales }">
              <Field
                v-for="localeCode in resolveFieldLocales(field)"
                :key="fieldLocaleKey(field, localeCode)"
                :name="fieldInputName(field, localeCode)"
                :rules="fieldRules(field)"
                v-slot="{ field: fctx, errors, meta }"
              >
                <div :class="['field-row', { 'localized-input': field.hasLocales, 'field-row--dirty': meta?.dirty }]">
                  <span v-if="field.hasLocales" class="locale-chip" :class="{ default: localeCode === defaultLocaleCode }">{{ localeCode }}</span>
                  <CodeMirrorInput
                    v-if="isCodeTextField(field)"
                    :id="fieldInputId(field, localeCode)"
                    :modelValue="toCodeEditorValue(fctx.value)"
                    @update:modelValue="fctx.onChange"
                    :extensions="codeEditorExtensions"
                    :disabled="readonly"
                    height="12rem"
                  />

                  <MarkdownEditorField
                    v-else-if="isMarkdownTextField(field)"
                    :id="fieldInputId(field, localeCode)"
                    :modelValue="toCodeEditorValue(fctx.value)"
                    @update:modelValue="fctx.onChange"
                    :disabled="readonly"
                    :placeholder="t('contents.markdown_editor.placeholder')"
                  />

                  <Textarea
                    v-else-if="isLongTextField(field)"
                    :id="fieldInputId(field, localeCode)"
                    v-bind="fctx"
                    :invalid="!!errors.length"
                    :disabled="readonly"
                    autoResize
                    rows="4"
                    fluid
                  />

                  <InputText
                    v-else-if="field.type === 'text'"
                    :id="fieldInputId(field, localeCode)"
                    v-bind="fctx"
                    :invalid="!!errors.length"
                    :disabled="readonly"
                    fluid
                  />

                  <RichTextEditor
                    v-else-if="field.type === 'rich_text'"
                    :id="fieldInputId(field, localeCode)"
                    :modelValue="fctx.value as any"
                    @update:modelValue="fctx.onChange"
                    :disabled="readonly"
                    placeholder="本文を入力…"
                  />

                  <div v-else-if="field.type === 'number'" class="number-field">
                    <InputNumber
                      :id="fieldInputId(field, localeCode)"
                      :modelValue="fctx.value"
                      @update:modelValue="fctx.onChange"
                      :invalid="!!errors.length"
                      :disabled="readonly"
                    />
                  </div>

                  <DatePicker
                    v-else-if="field.type === 'date'"
                    :id="fieldInputId(field, localeCode)"
                    :modelValue="fctx.value"
                    @update:modelValue="fctx.onChange"
                    dateFormat="yy/mm/dd"
                    :showTime="field.variant === 'datetime'"
                    :disabled="readonly"
                    showIcon
                  />

                  <CodeMirrorInput
                    v-else-if="field.type === 'json'"
                    :id="fieldInputId(field, localeCode)"
                    :modelValue="toJsonEditorValue(fctx.value)"
                    @update:modelValue="(value: string) => handleJsonChange(field, localeCode, value, fctx.onChange)"
                    :extensions="getJsonEditorExtensions(field)"
                    :disabled="readonly"
                    height="16rem"
                  />

                  <div v-else-if="field.type === 'boolean'" class="toggle-container">
                    <ToggleSwitch
                      :id="fieldInputId(field, localeCode)"
                      :modelValue="Boolean(fctx.value)"
                      @update:modelValue="fctx.onChange"
                      :disabled="readonly"
                    />
                    <label :for="fieldInputId(field, localeCode)" class="toggle-label">{{ t(`contents.${mode}.boolean_enabled`) }}</label>
                  </div>

                  <RelationFieldEditor
                    v-else-if="field.type === 'relation'"
                    v-bind="relationEditorProps(field, fctx.value, localeCode)"
                    :disabled="loading || readonly"
                    @update:modelValue="fctx.onChange"
                  />

                  <div v-else-if="field.type === 'media'" class="media-input">
                    <Button
                      type="button"
                      icon="lucide:images"
                      :label="t('contents.edit.media_select_button')"
                      :disabled="readonly || loading"
                      @click="openMediaDialog(field, fctx.onChange, fctx.value)"
                    />
                    <div class="selected-media" v-if="stringifyIds(fctx.value)">
                      <div v-for="(id, index) in parseIds(stringifyIds(fctx.value))" :key="id" class="media-thumb">
                        <img v-if="mediaMap.get(id)?.url" :src="mediaMap.get(id)?.url" :alt="mediaMap.get(id)?.name || id" />
                        <div class="caption">{{ mediaMap.get(id)?.name || id }}</div>
                        <div v-if="mediaVariant(field) === 'multiple' && parseIds(stringifyIds(fctx.value)).length > 1" class="media-thumb__actions">
                          <Button
                            type="button"
                            icon="lucide:chevron-up"
                            text
                            rounded
                            size="small"
                            :disabled="readonly || index === 0"
                            @click="moveMediaItem(fctx.value, index, -1, fctx.onChange)"
                          />
                          <Button
                            type="button"
                            icon="lucide:chevron-down"
                            text
                            rounded
                            size="small"
                            :disabled="readonly || index === parseIds(stringifyIds(fctx.value)).length - 1"
                            @click="moveMediaItem(fctx.value, index, 1, fctx.onChange)"
                          />
                        </div>
                      </div>
                    </div>
                    <small class="helper" v-if="mediaAllowedKinds(field)">
                      {{ t("models.detail.add_field_dialog.media_allowed_kinds") }}:
                      {{ Array.isArray(mediaAllowedKinds(field)) ? (mediaAllowedKinds(field) as string[]).join(", ") : mediaAllowedKinds(field) }}
                    </small>
                  </div>

                  <div v-else-if="field.type === 'list'" class="list-editor">
                    <ListFieldEditor
                      :idBase="fieldInputId(field, localeCode)"
                      :modelValue="fctx.value"
                      :itemType="resolveListItemType(field)"
                      :disabled="readonly"
                      @update:modelValue="fctx.onChange"
                    />
                  </div>

                  <div v-else class="not-implemented">{{ t(`contents.${mode}.not_implemented`, { type: field.type }) }}</div>

                  <small class="form-error" v-if="getJsonError(field, localeCode)">{{ getJsonError(field, localeCode) }}</small>
                  <small class="form-error" v-else-if="errors[0]">{{ errors[0] }}</small>
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <MediaPickerDialog
    v-model:visible="mediaDialogVisible"
    v-model:model-value="mediaDialogSelection"
    :selection-mode="mediaVariant(activeMediaField)"
    :allowed-kinds="activeMediaField ? mediaAllowedKinds(activeMediaField) : undefined"
    :title="t('contents.edit.media_dialog_title')"
    @confirm="handleMediaConfirm"
  />
</template>

<style lang="scss" scoped>
.form-section {
  background: var(--surface-0);
  border: 1px solid var(--surface-200);
  border-radius: var(--radius-2);
  padding: var(--space-16) var(--space-16) var(--space-20);

  .form-section__header {
    margin-bottom: var(--space-12);
  }
}

.fields-section {
  h2 {
    font-size: var(--font-18);
    font-weight: 500;
    color: var(--surface-900);
    margin: 0;
  }

  .fields-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);

    .field-item {
      display: flex;
      flex-direction: column;
      gap: var(--space-12);
      padding: var(--space-12) 0 var(--space-16);
      border-bottom: 1px dashed var(--surface-200);

      .field-row {
        display: flex;
        flex-direction: column;
        gap: var(--space-8);
        position: relative;
      }

      .field-row--dirty::before {
        content: "";
        position: absolute;
        top: calc(-1 * var(--space-4));
        bottom: calc(-1 * var(--space-4));
        left: calc(-1 * var(--space-8));
        width: 2px;
        border-radius: 999px;
        background: var(--green-500);
      }

      &:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      &.inline-field {
        flex-direction: row;
        align-items: flex-start;

        .field-label {
          width: 220px;
          min-width: 200px;
          margin-bottom: 0;
        }

        .field-control {
          flex: 1;
        }
      }

      .field-label {
        display: inline-flex;
        align-items: baseline;
        gap: var(--space-8);
        flex-wrap: wrap;
        font-weight: 500;
        color: var(--surface-700);
        margin-bottom: var(--space-4);

        .field-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 999px;
          background: var(--surface-100);
          color: var(--surface-500);
          font-size: var(--font-12);
        }

        .field-name {
          color: var(--surface-800);
        }

        .field-type-badge,
        .field-variant-badge {
          display: inline-flex;
          align-items: center;
          gap: var(--space-4);
          padding: 0 var(--space-8);
          height: 1.5rem;
          border-radius: 999px;
          background: var(--surface-100);
          color: var(--surface-600);
          font-size: var(--font-12);
          font-weight: 600;
          letter-spacing: 0.02em;
        }

        .field-variant-badge {
          background: var(--blue-50);
          color: var(--blue-700);
        }

        .required {
          color: var(--red-500);
          font-weight: 700;
        }

        .locale-badge {
          color: var(--primary-600);
          font-size: var(--font-12);
          padding: 0 var(--space-6);
          height: 1.4rem;
          border-radius: 999px;
          background: var(--primary-50);
        }
      }

      .field-control {
        display: flex;
        flex-direction: column;
        gap: var(--space-12);
      }

      .toggle-container {
        display: inline-flex;
        align-items: center;
        gap: var(--space-8);

        .toggle-label {
          font-size: var(--font-14);
          color: var(--surface-900);
        }
      }

      .not-implemented {
        font-size: var(--font-14);
        color: var(--surface-500);
        font-style: italic;
      }
    }
  }
}

.fields-toolbar {
  margin-bottom: var(--space-16);
  display: flex;
  justify-content: flex-start;
}

.localized-inputs {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  .localized-input {
    border: 1px solid var(--surface-200);
    border-radius: var(--radius-2);
    padding: var(--space-12);
    display: flex;
    flex-direction: column;
    gap: var(--space-8);

    .locale-chip {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: var(--space-4);
      padding: 0 var(--space-8);
      height: 1.5rem;
      border-radius: 999px;
      background: var(--surface-100);
      color: var(--surface-700);
      font-size: var(--font-12);

      &.default {
        background: var(--primary-50);
        color: var(--primary-700);
      }
    }
  }
}

.media-input {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);

  .selected-media {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-8);

    .media-thumb {
      border: 1px solid var(--surface-200);
      border-radius: 8px;
      padding: var(--space-6);
      background: var(--surface-0);
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      align-items: center;
      position: relative;

      img {
        width: 100%;
        height: 96px;
        object-fit: cover;
        border-radius: 6px;
      }

      .caption {
        font-size: var(--font-12);
        color: var(--surface-600);
        text-align: center;
        word-break: break-word;
      }

      .media-thumb__actions {
        position: absolute;
        top: var(--space-6);
        right: var(--space-6);
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
    }
  }
}

.list-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.helper {
  color: var(--surface-500);
  font-size: var(--font-12);
  line-height: 1.6;
}

.number-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);

  .number-hint {
    color: var(--surface-500);
    font-size: var(--font-12);
    line-height: 1.4;
  }
}
</style>
