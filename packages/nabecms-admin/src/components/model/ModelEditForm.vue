<script lang="ts" setup>
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Form, Field, type GenericObject, type SubmissionHandler, type FormContext } from "vee-validate";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { Checkbox } from "@/components/ui/element-plus";

export type ModelForm = { name: string; description?: string; isPublic: boolean };

const props = defineProps<{
  model: ModelForm;
  submitting?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  showPublicField?: boolean;
}>();

const emit = defineEmits<{
  (e: "submit", payload: ModelForm): void;
  (e: "cancel"): void;
  (e: "dirty-change", dirty: boolean): void;
  (e: "valid-change", valid: boolean): void;
}>();

const { t } = useI18n();

const initialValues = { ...props.model };
const formRef = ref<FormContext | null>(null);

/** Normalize vee-validate values into a model update payload. */
function toModelForm(values: GenericObject): ModelForm {
  if (typeof values.name !== "string") {
    throw new Error("Invalid model form payload: missing name");
  }
  const description = typeof values.description === "string" ? values.description : undefined;
  const isPublic = typeof values.isPublic === "boolean" ? values.isPublic : props.model.isPublic;
  return { name: values.name, description, isPublic };
}

const handleSubmit: SubmissionHandler = (values) => {
  const payload = toModelForm(values);
  emit("submit", payload);
};

const DirtyWatcher = defineComponent({
  name: "DirtyWatcher",
  props: { dirty: { type: Boolean, required: true } },
  emits: ["dirty-change"],
  setup(props, { emit }) {
    watch(
      () => props.dirty,
      (value) => emit("dirty-change", value),
      { immediate: true },
    );
    return () => null;
  },
});

const ValidWatcher = defineComponent({
  name: "ValidWatcher",
  props: { valid: { type: Boolean, required: true } },
  emits: ["valid-change"],
  setup(props, { emit }) {
    watch(
      () => props.valid,
      (value) => emit("valid-change", value),
      { immediate: true },
    );
    return () => null;
  },
});

/** Submit the internal form from a parent dialog footer. */
const submitForm = async () => {
  await formRef.value?.submitForm();
};

defineExpose({ submitForm });
</script>

<template>
  <Form ref="formRef" :initial-values="initialValues" @submit="handleSubmit" v-slot="{ meta }" class="model-edit-form">
    <div class="form-fields">
      <div class="field">
        <label for="name" class="field-label"> {{ t("models.create.name_label") }} </label>
        <Field name="name" rules="required|min:2" v-slot="{ field, errors }">
          <InputText
            id="name"
            v-bind="field"
            type="text"
            :placeholder="t('models.create.name_placeholder')"
            class="w-full"
            :invalid="!!errors.length"
            :disabled="submitting"
          />
          <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
        </Field>
      </div>

      <div class="field">
        <label for="description" class="field-label"> {{ t("models.create.description_label") }} </label>
        <Field name="description" v-slot="{ field }">
          <Textarea id="description" v-bind="field" rows="3" :placeholder="t('models.create.description_placeholder')" class="w-full" :disabled="submitting" />
        </Field>
      </div>

      <div v-if="showPublicField !== false" class="field checkbox-field">
        <Field name="isPublic" v-slot="{ field }">
          <Checkbox id="isPublic" :modelValue="field.value" @update:modelValue="field.onChange" binary :disabled="submitting" />
        </Field>
        <label for="isPublic" class="checkbox-label"> {{ t("models.create.is_public") }} </label>
      </div>
    </div>
    <DirtyWatcher :dirty="meta.dirty" @dirty-change="(val) => emit('dirty-change', val)" />
    <ValidWatcher :valid="meta.valid" @valid-change="(val) => emit('valid-change', val)" />
  </Form>
</template>

<style scoped lang="scss">
.model-edit-form {
  .form-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
    margin-bottom: calc(var(--space-24) + var(--space-8));

    .field {
      .field-label {
        display: block;
        font-size: var(--font-14);
        font-weight: 500;
        color: var(--surface-700);
        margin-bottom: var(--space-12);
      }

      .el-input,
      .el-textarea {
        width: 100%;
      }

      &.checkbox-field {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: var(--space-12);

        :deep(.el-checkbox) {
          align-self: center;
        }

        .field-label {
          display: none;
        }

        .checkbox-label {
          display: inline-flex;
          align-items: center;
          min-height: 1.5rem;
          font-size: var(--font-14);
          line-height: 1.3;
          color: var(--surface-700);
          cursor: pointer;
          user-select: none;
        }
      }
    }
  }
}
</style>
