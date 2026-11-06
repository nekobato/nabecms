<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import Button from "@/components/NabeButton.vue";

import { Card } from "@/components/ui/element-plus";
type NabeCmsStats = {
  models: number;
  entries: number;
  mediaFiles: number;
  users: number;
};

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();
const canExport = computed(() => authStore.user?.roleId.includes("system.super-admin") === true);

const nabeCmsVersion = (import.meta.env["VITE_NABECMS_VERSION"] as string | undefined) ?? "0.0.0";
const loading = ref(false);
const stats = ref<NabeCmsStats>({
  models: 0,
  entries: 0,
  mediaFiles: 0,
  users: 0,
});
/**
 * Load aggregate NabeCMS statistics for the settings overview.
 */
const fetchStats = async (): Promise<void> => {
  loading.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/dashboard");
    if (!res.ok) throw new Error(`status ${res.status}`);

    const data = (await res.json()) as { stats?: Partial<NabeCmsStats> };
    const next = data.stats ?? {};
    stats.value = {
      models: typeof next.models === "number" ? next.models : 0,
      entries: typeof next.entries === "number" ? next.entries : 0,
      mediaFiles: typeof next.mediaFiles === "number" ? next.mediaFiles : 0,
      users: typeof next.users === "number" ? next.users : 0,
    };
  } catch (error) {
    console.error("Failed to fetch settings stats:", error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  void fetchStats();
});
</script>

<template>
  <div class="settings-page">
    <PageSectionHeader :title="t('settings.title')" :description="t('settings.description')" :hint="t('settings.overview.hint_sidebar')" />

    <div class="overview-grid">
      <Card class="overview-card version-card">
        <template #header>
          <div class="card-header">
            <h2>{{ t("settings.overview.title") }}</h2>
          </div>
        </template>
        <template #content>
          <div class="version-content">
            <span class="version-label">{{ t("settings.overview.version_label") }}</span>
            <code class="version-value">{{ nabeCmsVersion }}</code>
          </div>
        </template>
      </Card>

      <Card class="overview-card stats-card">
        <template #header>
          <div class="card-header">
            <h2>{{ t("settings.overview.stats_title") }}</h2>
          </div>
        </template>
        <template #content>
          <p v-if="loading" class="loading-text">{{ t("settings.overview.stats_loading") }}</p>
          <div class="stats-grid">
            <div class="stat-item">
              <p class="stat-label">{{ t("dashboard.stats_models") }}</p>
              <p class="stat-value">{{ stats.models }}</p>
            </div>
            <div class="stat-item">
              <p class="stat-label">{{ t("dashboard.stats_entries") }}</p>
              <p class="stat-value">{{ stats.entries }}</p>
            </div>
            <div class="stat-item">
              <p class="stat-label">{{ t("dashboard.stats_media") }}</p>
              <p class="stat-value">{{ stats.mediaFiles }}</p>
            </div>
            <div class="stat-item">
              <p class="stat-label">{{ t("dashboard.stats_users") }}</p>
              <p class="stat-value">{{ stats.users }}</p>
            </div>
          </div>
        </template>
      </Card>

      <Card v-if="canExport" class="overview-card export-card">
        <template #header>
          <div class="card-header">
            <h2>{{ t("dataExport.title") }}</h2>
          </div>
        </template>
        <template #content>
          <div class="export-content">
            <p>{{ t("dataExport.description") }}</p>
            <Button severity="primary" icon="lucide:download" :label="t('dataExport.open')" @click="router.push({ name: 'settings-export' })" />
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-page {
  padding: var(--space-24);
  min-height: 100vh;
  background-color: var(--surface-50);

  .overview-grid {
    display: grid;
    gap: var(--space-16);
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  }

  .overview-card {
    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-16);
      padding: var(--space-16) var(--space-16) 0;

      h2 {
        margin: 0;
        font-size: var(--font-18);
        font-weight: 600;
        color: var(--surface-900);
      }

      p {
        margin: var(--space-4) 0 0;
        color: var(--surface-600);
        font-size: var(--font-14);
        line-height: 1.5;
      }
    }
  }

  .version-content {
    gap: var(--space-8);

    .version-label {
      margin: 0;
      color: var(--surface-600);
      font-size: var(--font-14);
    }

    .version-value {
      display: inline-flex;
      margin-left: 4px;
      width: fit-content;
      color: var(--surface-900);
      font-size: var(--font-14);
      font-weight: 600;
    }
  }

  .loading-text {
    margin: 0 0 var(--space-12);
    font-size: var(--font-14);
    color: var(--surface-600);
  }

  .export-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-16);

    p {
      margin: 0;
      color: var(--surface-600);
      font-size: var(--font-14);
      line-height: 1.5;
    }
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-12);

    .stat-item {
      padding: var(--space-12);
      border: 1px solid var(--surface-200);
      border-radius: 0.5rem;
      background-color: var(--surface-0);

      .stat-label {
        margin: 0 0 var(--space-4);
        color: var(--surface-600);
        font-size: var(--font-12);
      }

      .stat-value {
        margin: 0;
        color: var(--surface-900);
        font-size: var(--font-22);
        font-weight: 700;
      }
    }
  }
}

@media (max-width: 768px) {
  .settings-page {
    padding: var(--space-16);

    .stats-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
