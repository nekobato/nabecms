<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import PageSectionHeader from "@/components/PageSectionHeader.vue";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
const loading = ref(false);
const { t } = useI18n();
const router = useRouter();
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);
const breadcrumbModel = ref([{ label: t("settings.title"), to: "/settings", url: resolveUrl("/settings") }, { label: t("settings.integrations.title") }]);

const fetchIntegrations = async () => {
  loading.value = true;
  try {
    // TODO: Fetch integrations from API
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch (error) {
    console.error("Failed to fetch integrations:", error);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchIntegrations();
});
</script>

<template>
  <div class="integrations-page">
    <PageSectionHeader :title="t('settings.integrations.title')" :description="t('settings.integrations.description')" :breadcrumb-model="breadcrumbModel">
      <template #actions>
        <Button severity="primary" icon="lucide:plus" :label="t('settings.integrations.new')" />
      </template>
    </PageSectionHeader>

    <Card class="coming-soon">
      <template #content>
        <div class="coming-soon-content">
          <div class="icon">🔌</div>
          <p>{{ t("settings.integrations.coming_soon") }}</p>
        </div>
      </template>
    </Card>
  </div>
</template>

<style lang="scss" scoped>
.integrations-page {
  padding: var(--space-24);

  .coming-soon {
    .coming-soon-content {
      text-align: center;
      padding: var(--space-64) var(--space-32);

      .icon {
        font-size: var(--font-64);
        margin-bottom: var(--space-16);
      }

      p {
        color: var(--surface-500);
        font-size: var(--font-18);
      }
    }
  }
}
</style>
