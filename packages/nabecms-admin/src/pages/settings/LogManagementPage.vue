<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElForm, ElFormItem, ElInputNumber, ElSwitch } from "element-plus";
import type { LogManagementResponse } from "@nekobato/nabecms-core/contracts";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { useConfirm } from "@/services/feedback";
import { formatJapaneseDateTime } from "@/utils/dateTime";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";

const { t } = useI18n();
const auth = useAuthStore();
const confirm = useConfirm();
const allowed = computed(() => auth.user?.roleId.includes("system.super-admin") === true);
const data = ref<LogManagementResponse | null>(null);
const days = ref<number | undefined>(90);
const unlimited = ref(false);
const loading = ref(false);
const saving = ref(false);
const confirming = ref(false);
const error = ref("");
const saved = ref(false);
const submitted = ref(false);
const valid = computed(() => unlimited.value || (Number.isInteger(days.value) && Number(days.value) >= 1 && Number(days.value) <= 730000));
const proposed = computed(() => (unlimited.value ? false : days.value));
const dirty = computed(() => data.value !== null && proposed.value !== data.value.item.retentionDays);
const busy = computed(() => loading.value || saving.value || confirming.value);
const state = computed(() => data.value?.cleanup);
const statusLabel = computed(() => {
  if (!data.value) return "";
  const health = data.value.health;
  const status = health !== "recent" ? health : state.value?.status === "disabled" ? "skipped" : (state.value?.status ?? "never");
  return t(`logManagement.status.${status}`);
});
const date = (value: string | null | undefined) => (value ? formatJapaneseDateTime(value) : t("logManagement.noRecord"));

/** Refresh settings and status only when there are no unsaved changes. */
async function load() {
  if (!allowed.value) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await authorizedFetch(auth, "/api/admin/settings/logs");
    if (!response.ok) throw new Error("load");
    const result = (await response.json()) as LogManagementResponse;
    data.value = result;
    unlimited.value = result.item.retentionDays === false;
    days.value = result.item.retentionDays === false ? 90 : result.item.retentionDays;
  } catch {
    error.value = t("logManagement.loadError");
  } finally {
    loading.value = false;
  }
}

/** Save a captured value; confirmation never silently submits later edits. */
async function persist(retentionDays: number | false) {
  saving.value = true;
  try {
    const response = await authorizedFetch(auth, "/api/admin/settings/logs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays }),
    });
    if (!response.ok) throw new Error("save");
    if (data.value) data.value.item = { retentionDays };
    saved.value = true;
    await load();
  } catch {
    error.value = t("logManagement.saveError");
  } finally {
    saving.value = false;
  }
}

/** Require confirmation when a shorter policy makes more existing logs eligible. */
function submit() {
  if (!data.value || busy.value || !allowed.value) return;
  submitted.value = true;
  error.value = "";
  saved.value = false;
  if (!valid.value || !dirty.value) return;
  const next = proposed.value;
  if (next === undefined) return;
  const previous = data.value.item.retentionDays;
  if (next !== false && (previous === false || next < previous)) {
    confirming.value = true;
    confirm.require({
      header: t("logManagement.confirmTitle"),
      message: t("logManagement.confirmShorten", { days: next }),
      acceptLabel: t("logManagement.save"),
      rejectLabel: t("logManagement.cancel"),
      accept: () => persist(next),
      onHide: () => {
        confirming.value = false;
      },
    });
  } else {
    void persist(next);
  }
}

onMounted(load);
</script>

<template>
  <div class="log-management">
    <PageSectionHeader :title="t('logManagement.title')" :description="t('logManagement.description')" />
    <p v-if="!allowed" role="alert">{{ t("logManagement.forbidden") }}</p>
    <template v-else>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="saved && !dirty" role="status">{{ t("logManagement.saved") }}</p>
      <Button :label="t('logManagement.refresh')" :loading="loading" :disabled="busy || dirty" @click="load" />
      <p v-if="loading && !data" role="status">{{ t("logManagement.loading") }}</p>
      <div v-if="data" class="sections">
        <Card>
          <template #header
            ><h2>{{ t("logManagement.retentionTitle") }}</h2></template
          >
          <template #content>
            <p id="retention-hint">{{ t("logManagement.retentionHint") }}</p>
            <ElForm label-position="top" :disabled="busy" @submit.prevent="submit">
              <ElFormItem :label="t('logManagement.unlimited')" for="retention-unlimited">
                <ElSwitch id="retention-unlimited" v-model="unlimited" :aria-label="t('logManagement.unlimited')" />
              </ElFormItem>
              <ElFormItem
                v-if="!unlimited"
                :label="t('logManagement.days')"
                for="retention-days"
                :error="submitted && !valid ? t('logManagement.invalidDays') : undefined"
              >
                <ElInputNumber
                  id="retention-days"
                  v-model="days"
                  :min="1"
                  :max="730000"
                  :step="1"
                  :aria-invalid="submitted && !valid"
                  aria-describedby="retention-hint retention-error"
                />
              </ElFormItem>
              <p v-if="submitted && !valid" id="retention-error" role="alert" class="error">{{ t("logManagement.invalidDays") }}</p>
              <p>{{ t("logManagement.nextRun") }}</p>
              <Button type="submit" severity="primary" :label="t('logManagement.save')" :loading="saving" :disabled="busy || !dirty" />
            </ElForm>
          </template>
        </Card>
        <Card>
          <template #header
            ><h2>{{ t("logManagement.executionTitle") }}</h2></template
          >
          <template #content>
            <p role="status">{{ statusLabel }}</p>
            <p v-if="data.health === 'never' || data.health === 'stale' || data.health === 'interrupted' || state?.status === 'failed'" class="error">
              {{ t("logManagement.checkExecution") }}
            </p>
            <dl v-if="state">
              <dt>{{ t("logManagement.started") }}</dt>
              <dd>{{ date(state.startedAt) }}</dd>
              <dt>{{ t("logManagement.finished") }}</dt>
              <dd>{{ date(state.finishedAt) }}</dd>
              <dt>{{ t("logManagement.lastSuccess") }}</dt>
              <dd>{{ date(state.lastSuccessAt) }}</dd>
              <dt>{{ t("logManagement.cutoff") }}</dt>
              <dd>{{ date(state.cutoff) }}</dd>
              <dt>{{ t("logManagement.deleted") }}</dt>
              <dd>{{ t("logManagement.counts", { audit: state.auditDeleted, auth: state.authDeleted }) }}</dd>
              <dt>{{ t("logManagement.remaining") }}</dt>
              <dd>
                {{ state.remaining === null ? t("logManagement.unknown") : t(state.remaining ? "logManagement.remainingYes" : "logManagement.remainingNo") }}
              </dd>
              <template v-if="state.errorCode"
                ><dt>{{ t("logManagement.errorCode") }}</dt>
                <dd>{{ state.errorCode }}</dd></template
              >
            </dl>
            <p>{{ t("logManagement.statusHint") }}</p>
          </template>
        </Card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.log-management {
  padding: var(--space-24);
}
.sections {
  display: grid;
  gap: var(--space-24);
  margin-top: var(--space-16);
  max-width: 64rem;
}
h2 {
  margin: 0;
  font-size: var(--font-18);
}
p {
  line-height: 1.6;
}
.error {
  color: var(--el-color-danger);
}
dl {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) minmax(0, 2fr);
  gap: var(--space-12);
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .log-management {
    padding: var(--space-16);
  }
  dl {
    grid-template-columns: 1fr;
    gap: var(--space-8);
  }
  dd {
    margin-bottom: var(--space-8);
  }
}
</style>
