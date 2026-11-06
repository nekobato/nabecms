<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElPagination, ElTable, ElTableColumn, ElTabPane, ElTabs } from "element-plus";
import type { AuditLogItem, EntryRevisionLogItem, AuthLogItem, LogsResponse, AuthLogsResponse } from "@nekobato/nabecms-core/contracts";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import LogSearchForm from "@/components/LogSearchForm.vue";
import Button from "@/components/NabeButton.vue";
import { Tag } from "@/components/ui/element-plus";
import { formatLocalizedDateTime } from "@/utils/dateTime";

const { t, te, locale } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const tabs = ["audit", "revisions", "auth"] as const;
type Tab = (typeof tabs)[number];
const activeTab = ref<Tab>("audit");
const initialState = () => ({ total: 0, rows: 20, page: 1, loading: false, loaded: false, error: "", query: {} as Record<string, string>, request: 0 });
const states = reactive({ audit: initialState(), revisions: initialState(), auth: initialState() });
const auditItems = ref<AuditLogItem[]>([]);
const revisionItems = ref<EntryRevisionLogItem[]>([]);
const authItems = ref<AuthLogItem[]>([]);
const controllers: Partial<Record<Tab, AbortController>> = {};

/** SQLite timestamps are UTC, just like explicitly zoned ISO timestamps. */
const formatTime = (value: string | null) => {
  if (!value) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  return formatLocalizedDateTime(normalized, locale.value);
};
const label = (group: string, value: string | null) => (value ? (te(`logs.${group}.${value}`) ? t(`logs.${group}.${value}`) : value) : "—");
const resultSeverity = (value: string) => (value === "success" ? "success" : value === "failed" ? "danger" : value === "locked" ? "warn" : "info");
const actionSeverity = (value: string) => (value === "publish" ? "success" : value === "delete" ? "danger" : value === "create" ? "warn" : "info");
const snapshotKeys = ["status", "currentDraftRevisionId", "publishedRevisionId", "sourceRevisionId"] as const;
const snapshotRows = (snapshot: AuditLogItem["before"]) =>
  snapshotKeys
    .filter((key) => snapshot && Object.hasOwn(snapshot, key))
    .map((key) => ({
      key,
      value: key === "status" ? label("statuses", snapshot?.[key] ?? null) : (snapshot?.[key] ?? "—"),
    }));

/** Each tab owns its applied query and request version; stale replies never replace newer results. */
const fetchLogs = async (tab: Tab) => {
  const state = states[tab];
  controllers[tab]?.abort();
  const controller = new AbortController();
  controllers[tab] = controller;
  const request = ++state.request;
  const params = new URLSearchParams(state.query);
  const prefix = tab === "audit" ? "audit" : "revision";
  params.set(tab === "auth" ? "limit" : `${prefix}Limit`, String(state.rows));
  params.set(tab === "auth" ? "offset" : `${prefix}Offset`, String((state.page - 1) * state.rows));
  if (tab !== "auth") params.set(tab === "audit" ? "revisionLimit" : "auditLimit", "0");
  state.loading = true;
  state.error = "";
  try {
    const response = await authorizedFetch(authStore, `/api/admin/logs${tab === "auth" ? "/auth" : ""}?${params}`, { signal: controller.signal });
    if (!response.ok) {
      if (request === state.request) state.error = response.status === 403 ? "forbidden" : "error";
      return;
    }
    const data = (await response.json()) as LogsResponse & AuthLogsResponse;
    if (request !== state.request) return;
    const page = tab === "audit" ? data.auditLogs : tab === "revisions" ? data.entryRevisions : data.authLogs;
    if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0) throw new Error("Invalid log response");
    state.total = page.total;
    const lastPage = Math.max(1, Math.ceil(page.total / state.rows));
    if (state.page > lastPage) {
      state.page = lastPage;
      await fetchLogs(tab);
      return;
    }
    if (tab === "audit") auditItems.value = data.auditLogs.items;
    else if (tab === "revisions") revisionItems.value = data.entryRevisions.items;
    else authItems.value = data.authLogs.items;
    state.loaded = true;
  } catch {
    if (request === state.request && !controller.signal.aborted) state.error = "error";
  } finally {
    if (request === state.request) state.loading = false;
  }
};
const search = (tab: Tab, query: Record<string, string>) => {
  states[tab].query = { ...query };
  states[tab].page = 1;
  void fetchLogs(tab);
};
const changePage = (tab: Tab, page: number) => {
  if (states[tab].page === page) return;
  states[tab].page = page;
  void fetchLogs(tab);
};
const changeSize = (tab: Tab, rows: number) => {
  if (states[tab].rows === rows) return;
  states[tab].rows = rows;
  states[tab].page = 1;
  void fetchLogs(tab);
};
const viewEntry = (row: EntryRevisionLogItem) => {
  if (row.modelId && row.entryStatus) void router.push(`/contents/${encodeResourceId(row.modelId)}/${encodeResourceId(row.entryId)}`);
};
watch(activeTab, (tab) => {
  if (!states[tab].loaded && !states[tab].loading) void fetchLogs(tab);
});
onMounted(() => {
  void fetchLogs("audit");
});
onBeforeUnmount(() => {
  for (const tab of tabs) {
    ++states[tab].request;
    controllers[tab]?.abort();
  }
});
</script>

<template>
  <div class="logs-page">
    <PageSectionHeader :title="t('logs.title')" />
    <ElTabs v-model="activeTab" class="logs-tabs">
      <ElTabPane v-for="tab in tabs" :key="tab" :name="tab" :label="t(`logs.${tab}.title`)">
        <section class="tab-section" :aria-label="t(`logs.${tab}.title`)">
          <LogSearchForm v-if="tab !== 'revisions'" :mode="tab" @search="search(tab, $event)" />
          <div class="section-header">
            <h2>{{ t(`logs.${tab}.title`) }}</h2>
            <span v-if="!states[tab].loading && !states[tab].error" role="status">{{ t("logs.shared.count", { n: states[tab].total }) }}</span>
          </div>
          <div v-if="states[tab].loading" class="feedback" role="status" aria-live="polite">{{ t("logs.shared.loading") }}</div>
          <div v-else-if="states[tab].error" class="feedback error" role="alert">
            <p>{{ t(`logs.shared.${states[tab].error}`) }}</p>
            <Button :label="t('logs.shared.retry')" @click="fetchLogs(tab)" />
          </div>
          <template v-else>
            <div class="table-scroll" tabindex="0" role="region" :aria-label="t(`logs.${tab}.title`)">
              <ElTable v-if="tab === 'audit'" :data="auditItems" row-key="id" stripe :empty-text="t('logs.shared.empty')" class="log-table">
                <ElTableColumn type="expand" width="48">
                  <template #default="{ row }">
                    <div class="expansion-grid">
                      <div v-for="side in ['before', 'after'] as const" :key="side" class="snapshot">
                        <h3>{{ t(`logs.audit.${side}`) }}</h3>
                        <dl v-if="snapshotRows(row[side]).length">
                          <div v-for="field in snapshotRows(row[side])" :key="field.key">
                            <dt>{{ t(`logs.snapshot.${field.key}`) }}</dt>
                            <dd>{{ field.value }}</dd>
                          </div>
                        </dl>
                        <p v-else>{{ t("logs.shared.no_data") }}</p>
                      </div>
                    </div>
                  </template>
                </ElTableColumn>
                <ElTableColumn :label="t('logs.audit.time')" min-width="180"
                  ><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></ElTableColumn
                >
                <ElTableColumn :label="t('logs.audit.action')" min-width="112"
                  ><template #default="{ row }"
                    ><Tag :severity="actionSeverity(row.action)">{{ label("operations", row.action) }}</Tag></template
                  ></ElTableColumn
                >
                <ElTableColumn :label="t('logs.audit.target')" min-width="200"
                  ><template #default="{ row }"
                    ><div class="identity">
                      <span>{{ row.targetTable }}</span
                      ><span class="secondary">{{ row.targetId }}</span>
                    </div></template
                  ></ElTableColumn
                >
                <ElTableColumn :label="t('logs.audit.user')" min-width="160"
                  ><template #default="{ row }"
                    ><div class="identity">
                      <span>{{ row.userName || t("logs.shared.unknown_user") }}</span
                      ><span class="secondary">{{ row.userId || t("logs.shared.no_user") }}</span>
                    </div></template
                  ></ElTableColumn
                >
              </ElTable>
              <ElTable v-else-if="tab === 'auth'" :data="authItems" row-key="id" stripe :empty-text="t('logs.shared.empty')" class="log-table">
                <ElTableColumn :label="t('logs.audit.time')" min-width="180"
                  ><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></ElTableColumn
                >
                <ElTableColumn :label="t('logs.auth.user')" min-width="180"
                  ><template #default="{ row }"
                    ><div class="identity">
                      <span>{{ row.userName || t("logs.shared.unknown_user") }}</span
                      ><span class="secondary">{{ row.userId || t("logs.shared.no_user") }}</span>
                    </div></template
                  ></ElTableColumn
                >
                <ElTableColumn :label="t('logs.auth.result')" min-width="100"
                  ><template #default="{ row }"
                    ><Tag :severity="resultSeverity(row.result)">{{ label("results", row.result) }}</Tag></template
                  ></ElTableColumn
                >
                <ElTableColumn :label="t('logs.auth.reason')" min-width="220"
                  ><template #default="{ row }">{{ label("reasons", row.reason) }}</template></ElTableColumn
                >
              </ElTable>
              <ElTable v-else :data="revisionItems" row-key="id" stripe :empty-text="t('logs.shared.empty')" class="log-table">
                <ElTableColumn :label="t('logs.revisions.revision')" prop="revisionNumber" min-width="80" />
                <!-- @vue-generic {EntryRevisionLogItem} -->
                <ElTableColumn :label="t('logs.revisions.entry')" min-width="220"
                  ><template #default="{ row }"
                    ><div class="identity">
                      <span>{{ row.modelName || row.modelId || t("logs.shared.unavailable_target") }}</span
                      ><span class="secondary">{{ row.entryId }}</span
                      ><Button
                        v-if="row.modelId && row.entryStatus"
                        variant="link"
                        icon="lucide:arrow-right"
                        :label="t('logs.revisions.view_entry')"
                        @click="viewEntry(row)"
                      /></div></template
                ></ElTableColumn>
                <ElTableColumn :label="t('logs.revisions.status')" min-width="140"
                  ><template #default="{ row }">{{ label("statuses", row.status) }}</template></ElTableColumn
                >
                <ElTableColumn :label="t('logs.revisions.entry_status')" min-width="140"
                  ><template #default="{ row }">{{ label("statuses", row.entryStatus) }}</template></ElTableColumn
                >
                <ElTableColumn :label="t('logs.revisions.created_by')" min-width="160"
                  ><template #default="{ row }">{{ row.createdByName || t("logs.shared.unknown_user") }}</template></ElTableColumn
                >
                <ElTableColumn :label="t('logs.revisions.created_at')" min-width="180"
                  ><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></ElTableColumn
                >
                <ElTableColumn :label="t('logs.revisions.published_at')" min-width="180"
                  ><template #default="{ row }">{{ formatTime(row.publishedAt) }}</template></ElTableColumn
                >
              </ElTable>
            </div>
            <ElPagination
              :current-page="states[tab].page"
              :page-size="states[tab].rows"
              :page-sizes="[20, 50, 100]"
              :total="states[tab].total"
              :pager-count="5"
              layout="total, sizes, prev, pager, next"
              @current-change="changePage(tab, $event)"
              @size-change="changeSize(tab, $event)"
            />
          </template>
        </section>
      </ElTabPane>
    </ElTabs>
  </div>
</template>

<style scoped>
.logs-page {
  padding: var(--space-24);
  min-width: 0;
}
.logs-tabs {
  min-width: 0;
}
.tab-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-24);
  padding-top: var(--space-16);
  min-width: 0;
}
.section-header {
  display: flex;
  align-items: center;
  gap: var(--space-12);
}
.section-header h2 {
  margin: 0;
  font-size: var(--font-20);
}
.section-header span {
  color: var(--el-text-color-secondary);
  font-size: var(--font-14);
}
.table-scroll {
  overflow-x: auto;
  min-width: 0;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-8);
}
.table-scroll:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.log-table {
  width: 100%;
}
.log-table :deep(.cell) {
  word-break: normal;
  overflow-wrap: anywhere;
}
.log-table :deep(.el-tag--success) {
  --el-tag-text-color: var(--green-700);
}
.log-table :deep(.el-tag--danger) {
  --el-tag-text-color: var(--red-700);
}
.log-table :deep(.el-tag--warning) {
  --el-tag-text-color: var(--amber-700);
}
.log-table :deep(.el-tag--info) {
  --el-tag-text-color: var(--blue-700);
}
.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}
.secondary {
  font-size: var(--font-12);
  color: var(--el-text-color-secondary);
}
.expansion-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-16);
  padding: var(--space-16);
}
.snapshot {
  border: 1px solid var(--card-border);
  border-radius: var(--radius-8);
  overflow: hidden;
}
.snapshot h3 {
  margin: 0;
  background: var(--el-fill-color-light);
  padding: var(--space-12);
  font-size: var(--font-14);
}
.snapshot dl {
  margin: 0;
}
.snapshot dl > div {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(0, 1fr);
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
}
.snapshot dt {
  color: var(--el-text-color-secondary);
}
.snapshot dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.snapshot p {
  padding: var(--space-12);
  margin: 0;
}
.feedback {
  padding: var(--space-32);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-8);
  text-align: center;
}
.error p {
  margin-top: 0;
}
.tab-section :deep(.el-pagination) {
  flex-wrap: wrap;
  gap: var(--space-8);
}
@media (max-width: 640px) {
  .logs-page {
    padding: var(--space-16);
  }
  .expansion-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
