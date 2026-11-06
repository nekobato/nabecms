<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "@/services/feedback";
import ApiKeyCreateDialog, { type CreateApiKeyPayload } from "@/components/ApiKeyCreateDialog.vue";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
type ApiKeyItem = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  allowedModels: string[] | null;
  isRevoked: boolean;
  createdBy: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ModelOption = { id: string; name: string };

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const authStore = useAuthStore();

const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);
const breadcrumbModel = computed(() => [
  { label: t("settings.title"), to: "/settings", url: resolveUrl("/settings") },
  { label: t("settings.api_keys.title") },
]);

const loading = ref(false);
const errorMessage = ref<string | null>(null);
const apiKeys = ref<ApiKeyItem[]>([]);
const models = ref<ModelOption[]>([]);

const dialogVisible = ref(false);
const secretDialogVisible = ref(false);
const submitting = ref(false);
const rotateSubmitting: Record<string, boolean> = reactive({});
const revokeSubmitting: Record<string, boolean> = reactive({});
const deleteSubmitting: Record<string, boolean> = reactive({});
const createdSecret = ref<string | null>(null);

const sortedApiKeys = computed(() => {
  return [...apiKeys.value].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
});

const modelNameById = computed(() => new Map(models.value.map((model) => [model.id, model.name])));

const copySecret = async () => {
  if (!createdSecret.value) return;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(createdSecret.value);
    toast.add({ severity: "info", summary: t("common.copy"), detail: createdSecret.value, life: 1600 });
  } catch (error) {
    console.error("Failed to copy secret", error);
  }
};

const fetchModels = async () => {
  try {
    const res = await authorizedFetch(authStore, "/api/admin/models");
    if (!res.ok) return;
    const data = (await res.json()) as { items?: { id: string; name: string }[] };
    models.value = Array.isArray(data.items) ? data.items.map((item) => ({ id: item.id, name: item.name })) : [];
  } catch (error) {
    console.error("Failed to load models", error);
  }
};

const fetchApiKeys = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/api-keys");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { items?: ApiKeyItem[] };
    apiKeys.value = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    console.error("Failed to fetch API keys", error);
    errorMessage.value = t("settings.api_keys.error_fetch");
  } finally {
    loading.value = false;
  }
};

const openCreateDialog = () => {
  dialogVisible.value = true;
};

const closeDialogs = () => {
  dialogVisible.value = false;
  secretDialogVisible.value = false;
  createdSecret.value = null;
};

const upsertKey = (item: ApiKeyItem) => {
  const idx = apiKeys.value.findIndex((k) => k.id === item.id);
  if (idx >= 0) apiKeys.value.splice(idx, 1, item);
  else apiKeys.value = [item, ...apiKeys.value];
};

const saveApiKey = async (payload: CreateApiKeyPayload) => {
  submitting.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 409) {
        toast.add({ severity: "warn", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.error_conflict"), life: 3000 });
        return;
      }
      throw new Error(`save failed: ${status}`);
    }

    const data = (await res.json()) as { key: ApiKeyItem; secret?: string };
    if (data.key) upsertKey(data.key);
    if (data.secret) {
      createdSecret.value = data.secret;
      secretDialogVisible.value = true;
    }
    dialogVisible.value = false;
    toast.add({ severity: "success", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.toast_create_success"), life: 2500 });
  } catch (error) {
    console.error("Failed to save API key", error);
    toast.add({ severity: "error", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.error_save"), life: 3500 });
  } finally {
    submitting.value = false;
  }
};

const rotateApiKey = async (item: ApiKeyItem) => {
  if (item.isRevoked) return;
  rotateSubmitting[item.id] = true;
  try {
    const res = await authorizedFetch(authStore, `/api/admin/api-keys/${encodeResourceId(item.id)}/rotate`, { method: "POST" });
    if (!res.ok) throw new Error(`rotate failed ${res.status}`);
    const data = (await res.json()) as { key: ApiKeyItem; secret?: string };
    if (data.key) upsertKey(data.key);
    if (data.secret) {
      createdSecret.value = data.secret;
      secretDialogVisible.value = true;
    }
    toast.add({ severity: "success", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.toast_rotate_success"), life: 2500 });
  } catch (error) {
    console.error("Failed to rotate API key", error);
    toast.add({ severity: "error", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.error_rotate"), life: 3500 });
  } finally {
    rotateSubmitting[item.id] = false;
  }
};

const revokeApiKey = async (item: ApiKeyItem) => {
  if (item.isRevoked) return;
  revokeSubmitting[item.id] = true;
  try {
    const res = await authorizedFetch(authStore, `/api/admin/api-keys/${encodeResourceId(item.id)}/revoke`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`revoke failed ${res.status}`);
    const data = (await res.json()) as { key: ApiKeyItem };
    if (data.key) upsertKey(data.key);
    toast.add({ severity: "info", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.toast_revoke_success"), life: 2200 });
  } catch (error) {
    console.error("Failed to revoke API key", error);
    toast.add({ severity: "error", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.error_revoke"), life: 3500 });
  } finally {
    revokeSubmitting[item.id] = false;
  }
};

const deleteApiKey = async (item: ApiKeyItem) => {
  const confirmed = window.confirm(t("settings.api_keys.confirm_delete", { name: item.name }));
  if (!confirmed) return;
  deleteSubmitting[item.id] = true;
  try {
    const res = await authorizedFetch(authStore, `/api/admin/api-keys/${encodeResourceId(item.id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) throw new Error(`delete failed ${res.status}`);
    apiKeys.value = apiKeys.value.filter((k) => k.id !== item.id);
    toast.add({ severity: "success", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.toast_delete_success"), life: 2500 });
  } catch (error) {
    console.error("Failed to delete API key", error);
    toast.add({ severity: "error", summary: t("settings.api_keys.title"), detail: t("settings.api_keys.error_delete"), life: 3500 });
  } finally {
    deleteSubmitting[item.id] = false;
  }
};

const formatPermissions = (permissions: string[]) => {
  if (!permissions || permissions.length === 0) return t("settings.api_keys.permissions_empty");
  return permissions.join(", ");
};

/**
 * Formats API key model restrictions with human-readable model names.
 */
const formatAllowedModels = (allowedModels: string[] | null) => {
  if (!allowedModels || allowedModels.length === 0) return t("settings.api_keys.all_models");
  return allowedModels.map((modelId) => modelNameById.value.get(modelId) ?? t("settings.api_keys.unknown_model")).join(", ");
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatJapaneseDateTime(date);
};

onMounted(() => {
  fetchModels();
  fetchApiKeys();
});
</script>

<template>
  <div class="api-keys-page">
    <PageSectionHeader :title="t('settings.api_keys.title')" :description="t('settings.api_keys.description')" :breadcrumb-model="breadcrumbModel">
      <template #actions>
        <Button severity="primary" icon="lucide:plus" :label="t('settings.api_keys.new')" @click="openCreateDialog" />
      </template>
    </PageSectionHeader>

    <div v-if="loading" class="state">
      <p>{{ t("settings.api_keys.loading") }}</p>
    </div>
    <div v-else-if="errorMessage" class="state">
      <p>{{ errorMessage }}</p>
      <Button text severity="secondary" icon="lucide:refresh-cw" :label="t('settings.api_keys.retry')" @click="fetchApiKeys" />
    </div>
    <div v-else-if="sortedApiKeys.length === 0" class="state">
      <p>{{ t("settings.api_keys.empty") }}</p>
    </div>
    <div v-else class="grid-list">
      <Card v-for="item in sortedApiKeys" :key="item.id" class="key-card">
        <template #title>
          <div class="card-title">
            <div class="name">{{ item.name }}</div>
            <Tag
              :value="item.isRevoked ? t('settings.api_keys.status_revoked') : t('settings.api_keys.status_active')"
              :severity="item.isRevoked ? 'danger' : 'success'"
            />
          </div>
        </template>
        <template #content>
          <p class="description">{{ item.description || t("settings.api_keys.no_description") }}</p>
          <div class="meta">
            <div>
              <span class="label">{{ t("settings.api_keys.permissions") }}</span>
              <span class="value">{{ formatPermissions(item.permissions) }}</span>
            </div>
            <div>
              <span class="label">{{ t("settings.api_keys.allowed_models") }}</span>
              <span class="value">{{ formatAllowedModels(item.allowedModels) }}</span>
            </div>
            <div>
              <span class="label">{{ t("settings.api_keys.last_used_at") }}</span>
              <span class="value">{{ formatDateTime(item.lastUsedAt) }}</span>
            </div>
            <div>
              <span class="label">{{ t("settings.api_keys.created_at") }}</span>
              <span class="value">{{ formatDateTime(item.createdAt) }}</span>
            </div>
            <div v-if="item.revokedAt">
              <span class="label">{{ t("settings.api_keys.revoked_at") }}</span>
              <span class="value">{{ formatDateTime(item.revokedAt) }}</span>
            </div>
          </div>
          <div class="actions-row">
            <Button
              v-if="!item.isRevoked"
              size="small"
              text
              icon="lucide:refresh-cw"
              :label="t('settings.api_keys.rotate')"
              :loading="rotateSubmitting[item.id]"
              @click="rotateApiKey(item)"
            />
            <Button
              v-if="!item.isRevoked"
              size="small"
              severity="warning"
              text
              icon="lucide:ban"
              :label="t('settings.api_keys.revoke')"
              :loading="revokeSubmitting[item.id]"
              @click="revokeApiKey(item)"
            />
            <Button
              size="small"
              text
              severity="danger"
              icon="lucide:trash-2"
              :label="t('common.delete')"
              :loading="deleteSubmitting[item.id]"
              @click="deleteApiKey(item)"
            />
          </div>
        </template>
      </Card>
    </div>

    <ApiKeyCreateDialog v-model:visible="dialogVisible" :models="models" :submitting="submitting" @submit="saveApiKey" />

    <Dialog v-model:visible="secretDialogVisible" modal :draggable="false" :header="t('settings.api_keys.secret_dialog_title')" :style="{ width: '32rem' }">
      <p class="secret-note">{{ t("settings.api_keys.secret_dialog_note") }}</p>
      <div v-if="createdSecret" class="secret-box">
        <code>{{ createdSecret }}</code>
        <Button text icon="lucide:copy" :label="t('common.copy')" @click="copySecret" />
      </div>
      <template #footer>
        <div class="dialog-footer">
          <Button severity="primary" :label="t('common.close')" @click="closeDialogs" />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.api-keys-page {
  padding: var(--space-24);

  .state {
    text-align: center;
    padding: var(--space-48) 0;
    color: var(--surface-600);
  }

  .grid-list {
    display: grid;
    gap: var(--space-16);
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));

    .key-card {
      .card-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-8);
      }
      .name {
        font-weight: 700;
        font-size: var(--font-18);
      }
      .description {
        color: var(--surface-600);
        margin-bottom: var(--space-12);
      }
      .meta {
        display: grid;
        gap: var(--space-6);
        .label {
          font-size: var(--font-12);
          color: var(--surface-500);
          margin-right: var(--space-8);
        }
        .value {
          font-size: var(--font-14);
          color: var(--surface-800);
        }
      }
      .actions-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-8);
        margin-top: var(--space-12);
      }
    }
  }
}

.secret-note {
  color: var(--surface-700);
  margin-bottom: var(--space-12);
}

.secret-box {
  background: var(--surface-100);
  padding: var(--space-12);
  border-radius: var(--radius-8);
  display: flex;
  justify-content: space-between;
  gap: var(--space-12);
  align-items: center;
  code {
    word-break: break-all;
    font-size: var(--font-14);
  }
}
</style>
