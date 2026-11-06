<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";

const { t } = useI18n();
const auth = useAuthStore();
const allowed = computed(() => auth.user?.roleId.includes("system.super-admin") === true);
const downloading = ref<"content" | "logs" | null>(null);
const error = ref("");

/** Download one complete export only after the API has returned success. */
async function download(kind: "content" | "logs") {
  if (!allowed.value || downloading.value) return;
  downloading.value = kind;
  error.value = "";
  try {
    const response = await authorizedFetch(auth, `/api/admin/export/${kind}`);
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
      throw new Error(result?.error?.code === "EXPORT_TOO_LARGE" ? "tooLarge" : "failed");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nabecms-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (cause) {
    error.value = t(`dataExport.${cause instanceof Error && cause.message === "tooLarge" ? "tooLarge" : "failed"}`);
  } finally {
    downloading.value = null;
  }
}
</script>

<template>
  <main class="export-page">
    <PageSectionHeader
      :title="t('dataExport.title')"
      :breadcrumb-model="[{ label: t('sidebar.settings_general'), to: '/settings' }, { label: t('dataExport.title') }]"
    />
    <p class="intro">{{ t("dataExport.description") }}</p>
    <p v-if="!allowed" class="notice" role="alert">{{ t("dataExport.superAdminOnly") }}</p>
    <div v-else class="cards">
      <Card class="card">
        <template #header
          ><h2>{{ t("dataExport.contentTitle") }}</h2></template
        >
        <template #content>
          <div class="body">
            <p>{{ t("dataExport.contentDescription") }}</p>
            <p class="muted">{{ t("dataExport.contentNote") }}</p>
            <Button
              severity="primary"
              icon="lucide:download"
              :label="t('dataExport.downloadContent')"
              :loading="downloading === 'content'"
              :disabled="downloading !== null"
              @click="download('content')"
            />
          </div>
        </template>
      </Card>
      <Card class="card">
        <template #header
          ><h2>{{ t("dataExport.logsTitle") }}</h2></template
        >
        <template #content>
          <div class="body">
            <p>{{ t("dataExport.logsDescription") }}</p>
            <p class="muted">{{ t("dataExport.logsNote") }}</p>
            <Button
              severity="primary"
              icon="lucide:download"
              :label="t('dataExport.downloadLogs')"
              :loading="downloading === 'logs'"
              :disabled="downloading !== null"
              @click="download('logs')"
            />
          </div>
        </template>
      </Card>
    </div>
    <p v-if="allowed" class="notice">{{ t("dataExport.consistencyNote") }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </main>
</template>

<style scoped>
.export-page {
  min-height: 100vh;
  padding: var(--space-24);
  background: var(--surface-50);
}

.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-16);
}

.intro {
  margin: 0 0 var(--space-24);
  color: var(--surface-600);
  font-size: var(--font-14);
}

.card h2 {
  margin: 0;
  font-size: var(--font-18);
  font-weight: 600;
}

.body {
  display: flex;
  min-height: 14rem;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-16);
}

.body p {
  margin: 0;
  line-height: 1.5;
}

.body .muted,
.notice {
  color: var(--surface-600);
  font-size: var(--font-14);
}

.body button {
  margin-top: auto;
}

.notice {
  margin-top: var(--space-24);
}

.error {
  color: var(--el-color-danger);
}

@media (max-width: 768px) {
  .export-page {
    padding: var(--space-16);
  }
  .cards {
    grid-template-columns: 1fr;
  }
}
</style>
