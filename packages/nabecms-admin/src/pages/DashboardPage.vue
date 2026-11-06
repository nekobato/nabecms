<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { formatJapaneseDate } from "@/utils/dateTime";
import PageSectionHeader from "@/components/PageSectionHeader.vue";

import { Card } from "@/components/ui/element-plus";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { Tag } from "@/components/ui/element-plus";
const router = useRouter();
const { t } = useI18n();

const recentEntries = ref<
  Array<{
    id: string;
    modelId: string;
    modelName: string;
    displayTitle: string;
    status: string;
    updatedAt: string;
    updatedBy: string;
    updatedByName: string | null;
  }>
>([]);

const recentMedia = ref<Array<{ id: string; name: string; type: string; size: number; updatedAt: string }>>([]);

const auditLogs = ref<
  Array<{
    id: string;
    userId: string | null;
    userName: string | null;
    action: string;
    targetTable: string;
    targetId: string;
    createdAt: string;
  }>
>([]);

const authStore = useAuthStore();

const loading = ref(false);

const fetchDashboardData = async () => {
  loading.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/dashboard");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as {
      recentEntries?: Array<(typeof recentEntries.value)[number]>;
      recentMedia?: Array<(typeof recentMedia.value)[number]>;
      auditLogs?: Array<(typeof auditLogs.value)[number]>;
    };

    recentEntries.value = Array.isArray(data.recentEntries) ? data.recentEntries : [];
    recentMedia.value = Array.isArray(data.recentMedia) ? data.recentMedia : [];
    auditLogs.value = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  } catch (error) {
    console.error("Failed to fetch dashboard data:", error);
  } finally {
    loading.value = false;
  }
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return t("dashboard.one_day_ago");
  if (diffDays < 7) return t("dashboard.days_ago", { n: diffDays });
  return formatJapaneseDate(dateString);
};

const formatFileSize = (bytes: number) => {
  const sizes = ["Bytes", "KB", "MB", "GB"];
  if (bytes === 0) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
};

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case "published":
      return "success";
    case "draft":
      return "warning";
    case "archived":
      return "secondary";
    default:
      return "secondary";
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case "published":
      return t("dashboard.status_published");
    case "draft":
      return t("dashboard.status_draft");
    case "archived":
      return t("dashboard.status_archived");
    default:
      return status;
  }
};

const viewEntry = (entry: { id: string; modelId: string }) => {
  router.push(`/contents/${encodeResourceId(entry.modelId)}/${encodeResourceId(entry.id)}`);
};

const viewMedia = (mediaId: string) => {
  router.push(`/media/${encodeResourceId(mediaId)}`);
};

onMounted(() => {
  fetchDashboardData();
});
</script>

<template>
  <div class="dashboard">
    <PageSectionHeader :title="t('dashboard.title')" :description="t('dashboard.description')" />

    <div class="content-grid">
      <!-- Recent Entries -->
      <Card class="recent-entries">
        <template #header>
          <div class="card-header">
            <h2>{{ t("dashboard.recent_entries") }}</h2>
            <RouterLink class="card-link" to="/contents">{{ t("dashboard.view_entries") }}</RouterLink>
          </div>
        </template>
        <template #content>
          <div class="entry-list">
            <div v-for="entry in recentEntries" :key="entry.id" class="entry-item" @click="viewEntry(entry)">
              <div class="entry-header">
                <h3 class="entry-title">{{ entry.displayTitle }}</h3>
                <Tag :value="getStatusLabel(entry.status)" :severity="getStatusBadgeClass(entry.status)" />
              </div>
              <div class="entry-meta">
                <span class="entry-model">{{ entry.modelName || entry.modelId }}</span>
                <div class="entry-info">
                  <span>{{ entry.updatedByName || entry.updatedBy }}</span>
                  <span>{{ formatDate(entry.updatedAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <!-- Recent Media -->
      <Card class="recent-media">
        <template #header>
          <div class="card-header">
            <h2>{{ t("dashboard.recent_media") }}</h2>
            <RouterLink class="card-link" to="/media">{{ t("dashboard.view_media") }}</RouterLink>
          </div>
        </template>
        <template #content>
          <div class="media-list">
            <div v-for="media in recentMedia" :key="media.id" class="media-item" @click="viewMedia(media.id)">
              <div class="media-content">
                <div class="media-info">
                  <span class="media-icon">📷</span>
                  <div class="media-details">
                    <h3 class="media-name">{{ media.name }}</h3>
                    <p class="media-size">{{ formatFileSize(media.size) }}</p>
                  </div>
                </div>
                <span class="media-date">
                  {{ formatDate(media.updatedAt) }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </Card>

      <!-- Audit Logs -->
      <Card class="audit-logs">
        <template #header>
          <div class="card-header">
            <h2>{{ t("dashboard.audit_logs") }}</h2>
            <RouterLink class="card-link" to="/logs">{{ t("dashboard.view_logs") }}</RouterLink>
          </div>
        </template>
        <template #content>
          <div class="audit-table-scroll">
            <ElTable class="audit-table" :data="auditLogs" row-key="id" max-height="var(--audit-log-table-height-184)" style="width: 100%">
              <ElTableColumn prop="createdAt" :label="t('dashboard.audit_time')" style="min-width: 7rem">
                <template #default="slotProps">
                  {{ formatDate(slotProps.row.createdAt) }}
                </template>
              </ElTableColumn>
              <ElTableColumn prop="action" :label="t('dashboard.audit_action')" style="min-width: 8rem" />
              <ElTableColumn prop="targetTable" :label="t('dashboard.audit_target_table')" style="min-width: 8rem" />
              <ElTableColumn prop="targetId" :label="t('dashboard.audit_target_id')" style="min-width: 8rem" />
              <ElTableColumn prop="userName" :label="t('dashboard.audit_user')" style="min-width: 8rem">
                <template #default="slotProps">
                  {{ slotProps.row.userName || slotProps.row.userId || "-" }}
                </template>
              </ElTableColumn>
            </ElTable>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dashboard {
  padding: var(--space-24);
  min-height: 100vh;
  background-color: var(--surface-50);

  .content-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
    gap: var(--space-32);

    .recent-entries,
    .recent-media,
    .audit-logs {
      min-width: 0;

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-12);
        padding: var(--space-12) var(--space-16) 0 var(--space-16);

        h2 {
          font-size: var(--font-18);
          margin: 0;
        }

        .card-link {
          font-size: var(--font-12);
          font-weight: 600;
          color: var(--primary-600);
          text-decoration: none;
          white-space: nowrap;
          transition: color 0.15s ease-in-out;

          &:hover {
            color: var(--primary-800);
          }
        }
      }

      .entry-list,
      .media-list {
        .entry-item,
        .media-item {
          padding: var(--space-16) 0;
          border-bottom: 1px solid var(--surface-200);
          cursor: pointer;
          transition: background-color 0.15s ease-in-out;
          overflow: hidden;

          &:hover {
            background-color: var(--surface-50);
            border-radius: 0.375rem;
            margin: 0 calc(var(--space-16) * -1);
            padding-left: var(--space-16);
            padding-right: var(--space-16);
          }

          &:last-child {
            border-bottom: none;
          }
        }

        .entry-item {
          .entry-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            flex-wrap: wrap;
            gap: var(--space-8);
            margin-bottom: var(--space-8);

            .entry-title {
              font-size: var(--font-14);
              font-weight: 500;
              color: var(--surface-900);
              margin: 0;
              min-width: 0;
              flex-grow: 1;
              margin-right: var(--space-12);
              word-break: break-word;
            }
          }

          .entry-meta {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            column-gap: var(--space-12);
            row-gap: var(--space-4);
            font-size: var(--font-14);
            color: var(--surface-600);

            .entry-model {
              min-width: 0;
              overflow-wrap: anywhere;
            }

            .entry-info {
              display: flex;
              align-items: center;
              justify-self: end;
              justify-content: flex-end;
              flex-wrap: wrap;
              gap: var(--space-8);
              text-align: right;
              white-space: nowrap;
            }
          }
        }

        .media-item {
          .media-content {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: var(--space-8);

            .media-info {
              display: flex;
              align-items: center;
              gap: var(--space-12);
              min-width: 0;

              .media-icon {
                font-size: var(--font-18);
              }

              .media-details {
                .media-name {
                  font-size: var(--font-14);
                  font-weight: 500;
                  color: var(--surface-900);
                  margin: 0 0 var(--space-4) 0;
                  word-break: break-word;
                }

                .media-size {
                  font-size: var(--font-12);
                  color: var(--surface-600);
                  margin: 0;
                }
              }
            }

            .media-date {
              justify-self: end;
              font-size: var(--font-14);
              color: var(--surface-600);
              white-space: nowrap;
            }
          }
        }
      }
    }

    .audit-logs {
      grid-column: 1 / -1;

      .audit-table-scroll {
        overflow-x: auto;

        .audit-table {
          min-width: 42rem;
          --audit-log-header-height-40: var(--space-40);
          --audit-log-row-height-48: var(--space-48);
          --audit-log-table-height-184: 13.142858rem;

          :deep(.el-scrollbar__wrap) {
            scrollbar-gutter: stable;
          }

          :deep(.el-table__header > thead > tr),
          :deep(.el-table__header > thead > tr > th) {
            height: var(--audit-log-header-height-40);
            white-space: nowrap;
          }

          :deep(.el-table__header > thead > tr > th),
          :deep(.el-table__body > tbody > tr > td) {
            padding-block: var(--space-8);
          }

          :deep(.el-table__body > tbody > tr) {
            height: var(--audit-log-row-height-48);
          }

          :deep(.el-table__body > tbody > tr > td) {
            height: var(--audit-log-row-height-48);
            vertical-align: middle;
            white-space: nowrap;
          }
        }
      }
    }
  }
}

@media (max-width: 768px) {
  .dashboard {
    padding: var(--space-16);

    .actions-grid {
      grid-template-columns: 1fr;
    }

    .content-grid {
      grid-template-columns: 1fr;
      gap: var(--space-24);
    }
  }
}

@media (max-width: 640px) {
  .dashboard {
    .content-grid {
      .recent-entries,
      .recent-media {
        .entry-list,
        .media-list {
          .entry-item {
            .entry-header {
              align-items: flex-start;
            }

            .entry-meta {
              align-items: center;
            }

            .entry-info {
              align-items: center;
            }
          }

          .media-item {
            .media-info {
              align-items: flex-start;
            }
          }
        }
      }
    }
  }
}
</style>
