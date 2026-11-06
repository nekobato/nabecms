<script lang="ts" setup>
import { computed, reactive, watch } from "vue";
import { useI18n } from "vue-i18n";

import Button from "@/components/NabeButton.vue";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { Checkbox } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { MultiSelect } from "@/components/ui/element-plus";
export type ModelOption = { id: string; name: string };

export type CreateApiKeyPayload = {
  name: string;
  description: string | null;
  permissions: string[];
  allowedModels: string[];
};

const props = defineProps<{
  visible: boolean;
  models: ModelOption[];
  submitting?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", payload: CreateApiKeyPayload): void;
}>();

const { t } = useI18n();

const formState = reactive({
  name: "",
  description: "",
  permissions: {
    read: false,
    preview: false,
    manage: false,
  },
  allowedModels: [] as string[],
});

type PermissionKey = keyof typeof formState.permissions;

const permissionOptions: Array<{ key: PermissionKey; label: string }> = [
  { key: "read", label: "contents:read" },
  { key: "preview", label: "contents:preview" },
  { key: "manage", label: "contents:manage" },
];

const selectedPermissions = computed(() => permissionOptions.filter((opt) => formState.permissions[opt.key]).map((opt) => opt.label));
const allowedModelsPt = computed(() => ({
  header: {
    class: "api-key-model-select__header",
    "data-select-all-label": t("settings.api_keys.select_all_models"),
  },
}));

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value),
});

const resetForm = () => {
  formState.name = "";
  formState.description = "";
  formState.permissions.read = false;
  formState.permissions.preview = false;
  formState.permissions.manage = false;
  formState.allowedModels = [];
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) resetForm();
  },
);

const handleCancel = () => emit("update:visible", false);

const canSubmit = computed(() => formState.name.trim().length > 0 && selectedPermissions.value.length > 0);

const handleSubmit = () => {
  const payload: CreateApiKeyPayload = {
    name: formState.name.trim(),
    description: formState.description.trim() || null,
    permissions: selectedPermissions.value,
    allowedModels: formState.allowedModels,
  };

  emit("submit", payload);
};
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :draggable="false"
    :header="t('settings.api_keys.dialog_create_title')"
    :style="{ width: '40rem' }"
    :breakpoints="{ '960px': '90vw', '640px': '95vw' }"
  >
    <div class="form-grid">
      <label class="field-label for-input" for="key-name">{{ t("common.name") }}</label>
      <InputText id="key-name" v-model="formState.name" autocomplete="off" :placeholder="t('settings.api_keys.name_placeholder')" fluid />

      <label class="field-label for-input" for="key-description">{{ t("common.description") }}</label>
      <Textarea id="key-description" v-model="formState.description" rows="2" :placeholder="t('settings.api_keys.description_placeholder')" auto-resize fluid />

      <label class="field-label">{{ t("settings.api_keys.permissions") }}</label>
      <div class="permissions">
        <div v-for="opt in permissionOptions" :key="opt.key" class="flex gap-2">
          <Checkbox v-model="formState.permissions[opt.key]" :input-id="`perm-${opt.key}`" :binary="true" />
          <label :for="`perm-${opt.key}`">{{ opt.label }}</label>
        </div>
        <small v-if="selectedPermissions.length === 0" class="form-error">
          {{ t("settings.api_keys.permissions_required") }}
        </small>
      </div>

      <label class="field-label for-input">{{ t("settings.api_keys.allowed_models") }}</label>
      <MultiSelect
        v-model="formState.allowedModels"
        :options="props.models"
        option-label="name"
        option-value="id"
        display="chip"
        appendTo="body"
        class="allowed-models-select"
        :placeholder="t('settings.api_keys.allowed_models_placeholder')"
        :pt="allowedModelsPt"
      />
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button text :label="t('common.cancel')" @click="handleCancel" :disabled="props.submitting" />
        <Button severity="primary" :label="t('settings.api_keys.create_button')" :loading="props.submitting" :disabled="!canSubmit" @click="handleSubmit" />
      </div>
    </template>
  </Dialog>
</template>

<style lang="scss" scoped>
.form-grid {
  display: grid;
  grid-template-columns: 0.28fr 1fr;
  row-gap: var(--space-12);
  column-gap: var(--space-12);

  .field-label {
    text-align: right;
    color: var(--surface-700);
    align-items: center;
    font-weight: 500;

    &.for-input {
      padding-top: 0.5rem;
    }
  }

  .permissions {
    display: flex;
    gap: var(--space-12);
    flex-direction: column;
  }
}

:deep(.api-key-model-select__header) {
  display: flex;
  align-items: center;
  gap: var(--space-8);
}

:deep(.api-key-model-select__header::after) {
  content: attr(data-select-all-label);
  color: var(--surface-700);
  font-size: var(--font-14);
  font-weight: 600;
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
    .field-label {
      text-align: left;
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-12);
}
</style>
