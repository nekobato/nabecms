<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
import { MultiSelect } from "@/components/ui/element-plus";
import { InputSwitch } from "@/components/ui/element-plus";
import { Skeleton } from "@/components/ui/element-plus";
type WebhookItem = {
  id: string;
  name: string;
  url: string;
  eventFilters: string[];
  status: string | null;
  isActive: boolean;
  bodyTemplate?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type WebhookLog = {
  id: string;
  eventType: string;
  status: string;
  responseCode: number | null;
  latencyMs: number | null;
  attempt: number;
  error: string | null;
  createdAt: string;
  responseBody?: string | null;
};

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();

const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

/** Format webhook log timestamps for display. */
const formatDateTime = (value: string) => formatJapaneseDateTime(value);
const breadcrumbModel = computed(() => [{ label: t("settings.title"), to: "/settings", url: resolveUrl("/settings") }, { label: t("settings.hooks.title") }]);

const loading = ref(false);
const submitting = ref(false);
const deleting: Record<string, boolean> = reactive({});
const testing: Record<string, boolean> = reactive({});
const webhooks = ref<WebhookItem[]>([]);
const dialogVisible = ref(false);
const isEditMode = ref(false);
const editingId = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const logsVisible = ref(false);
const logsLoading = ref(false);
const logs: Record<string, WebhookLog[]> = reactive({});
const logsTotal: Record<string, number> = reactive({});
const currentLogWebhook = ref<WebhookItem | null>(null);

const form = reactive({
  name: "",
  url: "",
  secret: "",
  eventFilters: [] as string[],
  isActive: true,
  bodyTemplate: "",
});

const eventOptions = [
  "entry.created",
  "entry.updated",
  "entry.published",
  "entry.deleted",
  "model.created",
  "model.updated",
  "media.uploaded",
  "media.deleted",
  "api_key.created",
  "api_key.rotated",
];

const sortedWebhooks = computed(() => [...webhooks.value].sort((a, b) => ((a.updatedAt || "") > (b.updatedAt || "") ? -1 : 1)));

const resetForm = () => {
  form.name = "";
  form.url = "";
  form.secret = "";
  form.eventFilters = [];
  form.isActive = true;
  form.bodyTemplate = "";
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const stringProp = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};

const toWebhookItem = (input: unknown): WebhookItem => {
  const record = isRecord(input) ? input : {};
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  const url = typeof record.url === "string" ? record.url : "";
  const eventFilters = Array.isArray(record.eventFilters) ? record.eventFilters.filter((v): v is string => typeof v === "string") : [];
  const status = typeof record.status === "string" ? record.status : null;
  const isActive = record.isActive !== false && status !== "paused";
  const bodyTemplate = isRecord(record) ? (stringProp(record, "bodyTemplate") ?? null) : null;
  const createdAt = isRecord(record) ? stringProp(record, "createdAt") : undefined;
  const updatedAt = isRecord(record) ? stringProp(record, "updatedAt") : undefined;

  return {
    id,
    name,
    url,
    eventFilters,
    status,
    isActive,
    bodyTemplate,
    createdAt,
    updatedAt,
  };
};

const fetchWebhooks = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const res = await authorizedFetch(auth, "/api/admin/webhooks");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { items?: unknown[] };
    webhooks.value = Array.isArray(data.items) ? data.items.map(toWebhookItem) : [];
  } catch (error) {
    console.error("Failed to fetch webhooks", error);
    errorMessage.value = t("settings.hooks.error_fetch");
  } finally {
    loading.value = false;
  }
};

const fetchLogs = async (item: WebhookItem) => {
  logsLoading.value = true;
  currentLogWebhook.value = item;
  try {
    const res = await authorizedFetch(auth, `/api/admin/webhooks/${encodeResourceId(item.id)}/logs?limit=50`);
    if (!res.ok) throw new Error(`logs failed ${res.status}`);
    const data = (await res.json()) as { items?: unknown[]; total?: number };
    const parsed = Array.isArray(data.items)
      ? data.items
          .map((row): WebhookLog | null => {
            const rec = isRecord(row) ? row : {};
            const id = stringProp(rec, "id") ?? "";
            const eventType = stringProp(rec, "eventType") ?? "";
            const status = stringProp(rec, "status") ?? "";
            const createdAt = stringProp(rec, "createdAt") ?? "";
            const attemptRaw = rec.attempt;
            const attempt = typeof attemptRaw === "number" ? attemptRaw : Number(attemptRaw ?? 1) || 1;
            const responseCode = typeof rec.responseCode === "number" ? rec.responseCode : rec.responseCode == null ? null : Number(rec.responseCode);
            const latencyMs = typeof rec.latencyMs === "number" ? rec.latencyMs : rec.latencyMs == null ? null : Number(rec.latencyMs);
            const error = stringProp(rec, "error") ?? null;
            const responseBody = stringProp(rec, "responseBody") ?? null;
            if (!id) return null;
            return { id, eventType, status, createdAt, attempt, responseCode, latencyMs, error, responseBody };
          })
          .filter((v): v is WebhookLog => v !== null)
      : [];
    logs[item.id] = parsed;
    logsTotal[item.id] = typeof data.total === "number" ? data.total : parsed.length;
    logsVisible.value = true;
  } catch (error) {
    console.error("Failed to load webhook logs", error);
    toast.add({ severity: "error", summary: t("settings.hooks.title"), detail: t("settings.hooks.error_logs"), life: 3000 });
  } finally {
    logsLoading.value = false;
  }
};

const openCreateDialog = () => {
  resetForm();
  isEditMode.value = false;
  editingId.value = null;
  dialogVisible.value = true;
};

const openEditDialog = (item: WebhookItem) => {
  form.name = item.name;
  form.url = item.url;
  form.secret = "";
  form.eventFilters = [...item.eventFilters];
  form.isActive = item.isActive;
  form.bodyTemplate = item.bodyTemplate ?? "";
  isEditMode.value = true;
  editingId.value = item.id;
  dialogVisible.value = true;
};

const saveWebhook = async () => {
  if (!form.name.trim() || !form.url.trim()) {
    toast.add({ severity: "warn", summary: t("settings.hooks.title"), detail: t("settings.hooks.error_save"), life: 2400 });
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      secret: form.secret.trim() || null,
      eventFilters: form.eventFilters,
      isActive: form.isActive,
      status: form.isActive ? "active" : "paused",
      bodyTemplate: form.bodyTemplate.trim() || null,
    };

    let res: Response;
    if (isEditMode.value && editingId.value) {
      res = await authorizedFetch(auth, `/api/admin/webhooks/${encodeResourceId(editingId.value)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      res = await authorizedFetch(auth, "/api/admin/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) throw new Error(`save failed ${res.status}`);
    await fetchWebhooks();
    dialogVisible.value = false;
    toast.add({
      severity: "success",
      summary: t("settings.hooks.title"),
      detail: isEditMode.value ? t("settings.hooks.toast_update_success") : t("settings.hooks.toast_create_success"),
      life: 2500,
    });
  } catch (error) {
    console.error("Failed to save webhook", error);
    toast.add({ severity: "error", summary: t("settings.hooks.title"), detail: t("settings.hooks.error_save"), life: 3200 });
  } finally {
    submitting.value = false;
  }
};

// delete is handled via deleteWebhookFromDialog

const deleteWebhookFromDialog = async () => {
  if (!editingId.value) return;
  if (!confirm(t("settings.hooks.confirm_delete", { name: form.name || editingId.value }))) return;
  deleting[editingId.value] = true;
  try {
    const res = await authorizedFetch(auth, `/api/admin/webhooks/${encodeResourceId(editingId.value)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`delete failed ${res.status}`);
    webhooks.value = webhooks.value.filter((w) => w.id !== editingId.value);
    dialogVisible.value = false;
    toast.add({ severity: "success", summary: t("settings.hooks.title"), detail: t("settings.hooks.toast_delete_success"), life: 2200 });
  } catch (error) {
    console.error("Failed to delete webhook", error);
    toast.add({ severity: "error", summary: t("settings.hooks.title"), detail: t("settings.hooks.error_delete"), life: 3200 });
  } finally {
    if (editingId.value) deleting[editingId.value] = false;
  }
};

const testWebhook = async (item: WebhookItem) => {
  testing[item.id] = true;
  try {
    const res = await authorizedFetch(auth, `/api/admin/webhooks/${encodeResourceId(item.id)}/test`, { method: "POST" });
    if (!res.ok) throw new Error(`test failed ${res.status}`);
    toast.add({ severity: "success", summary: t("settings.hooks.title"), detail: t("settings.hooks.toast_test_success"), life: 2200 });
  } catch (error) {
    console.error("Failed to test webhook", error);
    toast.add({ severity: "error", summary: t("settings.hooks.title"), detail: t("settings.hooks.error_test"), life: 3200 });
  } finally {
    testing[item.id] = false;
  }
};

onMounted(fetchWebhooks);
</script>

<template>
  <div class="hooks-page">
    <PageSectionHeader :title="t('settings.hooks.title')" :description="t('settings.hooks.description')" :breadcrumb-model="breadcrumbModel">
      <template #actions>
        <Button severity="primary" icon="lucide:plus" :label="t('settings.hooks.new')" @click="openCreateDialog" />
      </template>
    </PageSectionHeader>

    <Card>
      <template #content>
        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>

        <div v-if="loading" class="skeletons">
          <Skeleton height="2.5rem" class="mb-2" v-for="n in 3" :key="n" />
        </div>

        <div v-else-if="sortedWebhooks.length === 0" class="empty-state">
          <div class="empty-icon" aria-hidden="true">
            <NabeIcon :icon="ICONS.send" />
          </div>
          <h3>{{ t("settings.hooks.empty_title") }}</h3>
          <Button severity="primary" icon="lucide:plus" :label="t('settings.hooks.new')" @click="openCreateDialog" />
        </div>

        <ElTable v-else :data="sortedWebhooks" row-key="id" size="small" class="webhook-table">
          <ElTableColumn prop="name" :label="t('settings.hooks.name')">
            <template #default="{ row: data }">
              <div class="name-cell">
                <div class="name">{{ data.name }}</div>
                <div class="url">{{ data.url }}</div>
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('settings.hooks.events')">
            <template #default="{ row: data }">
              <div class="chips">
                <Tag v-for="evt in data.eventFilters" :key="evt" severity="info" :value="evt" rounded />
              </div>
            </template>
          </ElTableColumn>
          <ElTableColumn :label="t('settings.hooks.status')" style="width: 140px">
            <template #default="{ row: data }">
              <Tag :severity="data.isActive ? 'success' : 'secondary'" :value="data.isActive ? t('settings.hooks.active') : t('settings.hooks.paused')" />
            </template>
          </ElTableColumn>
          <!-- @vue-generic {WebhookItem} -->
          <ElTableColumn :label="t('common.actions')" style="width: 220px">
            <template #default="{ row: data }">
              <div class="actions">
                <Button size="small" text icon="lucide:eye" :label="t('settings.hooks.view_logs')" @click="fetchLogs(data)" />
                <Button size="small" text icon="lucide:send" :label="t('settings.hooks.test')" :loading="testing[data.id]" @click="testWebhook(data)" />
                <Button size="small" text icon="lucide:pencil" @click="openEditDialog(data)" />
              </div>
            </template>
          </ElTableColumn>
        </ElTable>
      </template>
    </Card>

    <Dialog v-model:visible="dialogVisible" modal :draggable="false" :header="t('settings.hooks.new')" style="max-width: 640px" class="hook-dialog">
      <div class="form-grid">
        <div class="field">
          <label>{{ t("settings.hooks.name") }}</label>
          <InputText v-model="form.name" :placeholder="t('settings.hooks.name_placeholder')" />
        </div>
        <div class="field">
          <label>{{ t("settings.hooks.url") }}</label>
          <InputText v-model="form.url" :placeholder="t('settings.hooks.url_placeholder')" />
        </div>
        <div class="field">
          <label>{{ t("settings.hooks.secret") }}</label>
          <InputText v-model="form.secret" :placeholder="t('settings.hooks.secret_placeholder')" />
          <small>{{ t("settings.hooks.secret_hint") }}</small>
        </div>
        <div class="field">
          <label>{{ t("settings.hooks.body_template") }}</label>
          <Textarea v-model="form.bodyTemplate" rows="6" auto-resize :placeholder="t('settings.hooks.body_template_placeholder')" />
          <small>{{ t("settings.hooks.body_template_hint") }}</small>
        </div>
        <div class="field">
          <label>{{ t("settings.hooks.events") }}</label>
          <MultiSelect
            v-model="form.eventFilters"
            :options="eventOptions"
            :placeholder="t('settings.hooks.events_placeholder')"
            display="chip"
            class="w-full"
          />
        </div>
        <div class="field inline toggle-field">
          <label class="toggle-field__label">{{ t("settings.hooks.active") }}</label>
          <InputSwitch v-model="form.isActive" class="toggle-field__control" />
        </div>
      </div>

      <template #footer>
        <Button text :label="t('common.cancel')" @click="dialogVisible = false" />
        <div class="dialog-actions">
          <Button
            v-if="isEditMode"
            text
            severity="danger"
            :label="t('common.delete')"
            :loading="editingId ? deleting[editingId] : false"
            @click="deleteWebhookFromDialog"
          />
          <Button severity="primary" :label="t('common.save')" :loading="submitting" @click="saveWebhook" />
        </div>
      </template>
    </Dialog>

    <Dialog
      v-model:visible="logsVisible"
      modal
      :draggable="false"
      :header="currentLogWebhook?.name || t('settings.hooks.logs')"
      style="max-width: 900px"
      class="logs-dialog"
    >
      <div class="logs-header">
        <div>
          <div class="subtitle">{{ currentLogWebhook?.url }}</div>
          <div class="count" v-if="currentLogWebhook">{{ t("settings.hooks.logs_total", { total: logsTotal[currentLogWebhook.id] ?? 0 }) }}</div>
        </div>
      </div>

      <ElTable
        :data="currentLogWebhook ? logs[currentLogWebhook.id] || [] : []"
        size="small"
        :loading="logsLoading"
        :empty-message="t('settings.hooks.no_logs')"
      >
        <ElTableColumn prop="createdAt" :label="t('settings.hooks.created_at')" style="width: 200px">
          <template #default="{ row: data }">
            {{ formatDateTime(data.createdAt) }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="eventType" :label="t('settings.hooks.events')" />
        <ElTableColumn prop="status" :label="t('settings.hooks.status')" style="width: 140px">
          <template #default="{ row: data }">
            <Tag :severity="data.status === 'success' ? 'success' : data.status === 'failed' ? 'danger' : 'secondary'" :value="data.status" />
          </template>
        </ElTableColumn>
        <ElTableColumn prop="responseCode" :label="t('settings.hooks.response_code')" style="width: 120px">
          <template #default="{ row: data }">
            {{ data.responseCode ?? "—" }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="latencyMs" :label="t('settings.hooks.latency_ms')" style="width: 120px">
          <template #default="{ row: data }">
            {{ data.latencyMs != null ? `${data.latencyMs} ms` : "—" }}
          </template>
        </ElTableColumn>
        <ElTableColumn prop="attempt" :label="t('settings.hooks.attempt')" style="width: 90px" />
        <ElTableColumn prop="error" :label="t('settings.hooks.error')">
          <template #default="{ row: data }">
            <span class="error-text" v-if="data.error">{{ data.error }}</span>
            <span v-else>—</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="responseBody" :label="t('settings.hooks.response_body')">
          <template #default="{ row: data }">
            <pre v-if="data.responseBody" class="body-preview">{{ data.responseBody }}</pre>
            <span v-else>—</span>
          </template>
        </ElTableColumn>
      </ElTable>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.hooks-page {
  padding: var(--space-24);

  .error {
    color: var(--red-500);
    margin-bottom: var(--space-12);
  }

  .webhook-table {
    .name-cell {
      .name {
        font-weight: 600;
        color: var(--surface-900);
      }
      .url {
        color: var(--surface-500);
        font-size: var(--font-12);
        word-break: break-all;
      }
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-8);
    }
    .actions {
      display: flex;
      gap: var(--space-8);
      justify-content: flex-end;
    }
    .toggle {
      margin-top: var(--space-6);
    }
  }

  .skeletons {
    padding: var(--space-8) 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-12);
    padding: var(--space-40) var(--space-16);
    text-align: center;

    .empty-icon {
      display: grid;
      place-items: center;
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 999px;
      background: var(--surface-100);
      color: var(--primary-color);
      font-size: 1.25rem;
    }

    h3,
    p {
      margin: 0;
    }

    h3 {
      color: var(--surface-900);
      font-size: var(--font-18);
    }

    p {
      max-width: 30rem;
      color: var(--surface-600);
      font-size: var(--font-14);
    }
  }
}

:global(.hook-dialog .el-dialog__footer) {
  padding-top: var(--space-16);
}

.hook-dialog {
  .form-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    label {
      font-weight: 600;
      color: var(--surface-800);
    }
    small {
      color: var(--surface-500);
    }
  }
  .inline {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 0;
  }

  .dialog-actions {
    display: inline-flex;
    gap: var(--space-8);
    align-items: center;
  }
}

.toggle-field {
  display: flex;
  min-height: 2.5rem;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;

  .toggle-field__label {
    display: inline-flex;
    align-items: center;
    min-height: 2rem;
    margin: 0 var(--space-16) 0 0;
    line-height: 2rem;
  }

  :deep(.el-switch) {
    flex: 0 0 auto;
    align-self: center;
    margin: 0;
    transform: none;
  }
}

.logs-dialog {
  .logs-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--space-12);

    .subtitle {
      color: var(--surface-600);
      font-size: var(--font-12);
      word-break: break-all;
    }

    .count {
      color: var(--surface-500);
      font-size: var(--font-12);
    }
  }

  .error-text {
    color: var(--red-500);
  }

  .body-preview {
    max-height: 140px;
    overflow: auto;
    background: var(--surface-50);
    border: 1px solid var(--surface-200);
    padding: var(--space-8);
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }
}
</style>
