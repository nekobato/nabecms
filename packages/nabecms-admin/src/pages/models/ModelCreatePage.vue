<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Form, Field, type GenericObject, type SubmissionHandler } from "vee-validate";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { Checkbox } from "@/components/ui/element-plus";
type CreateModelResponse = {
  item?: { id?: string } & Record<string, unknown>;
};

const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();

const loading = ref(false);

type ModelForm = { name: string; description?: string; isPublic: boolean };

const initialValues: ModelForm = {
  name: "",
  description: "",
  isPublic: true,
};

function toModelForm(values: GenericObject): ModelForm {
  if (typeof values.name !== "string") {
    throw new Error("Invalid model form payload: missing name");
  }
  const description = typeof values.description === "string" ? values.description : undefined;
  const isPublic = typeof values.isPublic === "boolean" ? values.isPublic : true;
  return { name: values.name, description, isPublic };
}

const handleSubmit: SubmissionHandler = async (values) => {
  const payload = toModelForm(values);
  loading.value = true;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }
    const res = await authorizedFetch(authStore, "/api/admin/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Request failed with status ${res.status}`);
    }
    const data = (await res.json()) as CreateModelResponse;
    const modelId = data?.item?.id;
    if (typeof modelId !== "string" || modelId.length === 0) {
      throw new Error("Response did not include model id");
    }
    router.push(`/models/${encodeResourceId(modelId)}`);
  } catch (error) {
    console.error("Failed to create model:", error);
  } finally {
    loading.value = false;
  }
};

const cancel = () => {
  router.back();
};

defineExpose({ submit: handleSubmit });
</script>

<template>
  <div class="model-create">
    <PageSectionHeader :title="t('models.create.title')" :description="t('models.create.description')" />

    <Card class="form-container">
      <template #content>
        <Form @submit="handleSubmit" :initial-values="initialValues" class="model-form">
          <div class="form-fields">
            <div class="field">
              <label for="name" class="field-label"> {{ t("models.create.name_label") }} </label>
              <Field name="name" rules="required|min:2" v-slot="{ field, errors }">
                <InputText id="name" v-bind="field" type="text" :placeholder="t('models.create.name_placeholder')" class="w-full" :invalid="!!errors.length" />
                <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
              </Field>
            </div>

            <div class="field">
              <label for="description" class="field-label"> {{ t("models.create.description_label") }} </label>
              <Field name="description" v-slot="{ field }">
                <Textarea id="description" v-bind="field" rows="3" :placeholder="t('models.create.description_placeholder')" class="w-full" />
              </Field>
            </div>

            <div class="field checkbox-field">
              <Field name="isPublic" v-slot="{ field }">
                <Checkbox id="isPublic" :modelValue="field.value" @update:modelValue="field.onChange" binary />
              </Field>
              <label for="isPublic" class="checkbox-label"> {{ t("models.create.is_public") }} </label>
            </div>
          </div>

          <div class="form-actions">
            <Button
              type="submit"
              :disabled="loading"
              :loading="loading"
              severity="primary"
              class="submit-button"
              :label="loading ? t('models.create.submitting') : t('models.create.submit')"
            />
            <Button type="button" @click="cancel" severity="secondary" variant="outlined" class="cancel-button" :label="t('models.create.cancel')" />
          </div>
        </Form>
      </template>
    </Card>
  </div>
</template>

<style lang="scss" scoped>
.model-create {
  padding: var(--space-24);
  min-height: 100vh;
  background-color: var(--surface-50);

  .form-container {
    max-width: 40rem;
    margin: 0 auto;

    .model-form {
      .form-fields {
        display: flex;
        flex-direction: column;
        gap: var(--space-32);
        margin-bottom: calc(var(--space-32) + var(--space-8));

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

      .form-actions {
        display: flex;
        gap: var(--space-16);
        justify-content: flex-end;
        padding-top: var(--space-24);
        border-top: 1px solid var(--surface-200);

        .submit-button,
        .cancel-button {
          min-width: 100px;
          padding: var(--space-12) var(--space-24);
          font-weight: 500;
        }
      }
    }
  }
}

@media (max-width: 768px) {
  .model-create {
    padding: var(--space-16);

    .form-container {
      max-width: none;
      margin: 0;

      .model-form {
        .form-fields {
          gap: var(--space-24);
        }

        .form-actions {
          flex-direction: column;

          .submit-button,
          .cancel-button {
            width: 100%;
            order: 1;
          }

          .cancel-button {
            order: 2;
          }
        }
      }
    }
  }
}
</style>
