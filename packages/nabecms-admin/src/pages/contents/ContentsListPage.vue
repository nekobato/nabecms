<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";

import { Card } from "@/components/ui/element-plus";
type ModelSummary = {
  id: string;
  name: string;
  description: string | null;
  entriesCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toModelSummary = (input: unknown): ModelSummary => {
  const record = isRecord(input) ? input : {};
  const idRaw = record.id;
  const nameRaw = record.name;
  const descriptionRaw = record.description;
  const entriesCountRaw = record.entriesCount;

  return {
    id: typeof idRaw === "string" ? idRaw : String(idRaw ?? ""),
    name: typeof nameRaw === "string" ? nameRaw : String(nameRaw ?? ""),
    description: typeof descriptionRaw === "string" ? descriptionRaw : descriptionRaw == null ? null : String(descriptionRaw),
    entriesCount: typeof entriesCountRaw === "number" && Number.isFinite(entriesCountRaw) ? entriesCountRaw : Number(entriesCountRaw ?? 0) || 0,
  };
};

const { t } = useI18n();
const authStore = useAuthStore();

const models = ref<ModelSummary[]>([]);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

const fetchModels = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    if (!authStore.accessToken) {
      await authStore.refresh().catch(() => undefined);
    }
    const res = await authorizedFetch(authStore, "/api/admin/models");
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || `Request failed with status ${res.status}`);
    }
    const data = await res.json();
    const items: unknown[] = Array.isArray(data?.items) ? data.items : [];
    models.value = items.map((item) => toModelSummary(item));
  } catch (error) {
    console.error("Failed to fetch models:", error);
    errorMessage.value = t("contents.list.error");
    models.value = [];
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  fetchModels();
});
</script>

<template>
  <div class="contents-list">
    <PageSectionHeader :title="t('contents.list.title')" :description="t('contents.list.description')" />

    <Card class="list-card">
      <template #content>
        <div class="owned-data-view">
          <div v-if="loading" class="row loading"><NabeIcon :icon="ICONS.loading" class="mr-2" spin /> {{ t("contents.list.loading") }}</div>

          <div v-else-if="errorMessage" class="row empty">
            <NabeIcon :icon="ICONS.error" class="mr-2" />
            {{ errorMessage }}
          </div>

          <div v-else-if="models.length === 0" class="row empty">
            <NabeIcon :icon="ICONS.box" class="mr-2" />
            {{ t("contents.list.empty") }}
          </div>

          <template v-else>
            <RouterLink v-for="m in models" :key="m.id" class="row item" :to="`/contents/${encodeResourceId(m.id)}`">
              <div class="col col-name">
                <div class="name">{{ m.name }}</div>
                <div class="desc">{{ m.description }}</div>
              </div>
              <div class="col col-entries">{{ t("contents.list.entry_count", { n: m.entriesCount }) }}</div>
            </RouterLink>
          </template>
        </div>
      </template>
    </Card>
  </div>
</template>

<style lang="scss" scoped>
.contents-list {
  padding: var(--space-24);
}

.list-card {
}

/* Rows */
.row.item,
.row.loading,
.row.empty {
  display: grid;
  grid-template-columns: 1fr 160px;
  gap: var(--space-8);
  align-items: center;
  padding: var(--space-16) var(--space-16);
}

.row.item + .row.item {
  border-top: 1px solid var(--surface-200);
}

.row.item {
  cursor: pointer;
  color: inherit;
  text-decoration: none;
  touch-action: manipulation;
  transition: background-color 0.15s ease-in-out;
}
.row.item:hover {
  background: var(--surface-100);
}
.row.item:focus-visible {
  background: var(--surface-100);
  outline: 2px solid rgb(var(--primary-500-rgb) / 0.4);
  outline-offset: -2px;
}

.col-name .name {
  font-weight: 700;
  color: var(--surface-900);
}
.col-name .desc {
  color: var(--surface-600);
  font-size: var(--font-14);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  overflow: hidden;
}

.col-entries {
  color: var(--surface-900);
  align-self: center;
  justify-self: end;
  text-align: right;
}

@media (max-width: 640px) {
  .list-head {
    display: none;
  }

  .row.item {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .row.loading,
  .row.empty {
    grid-template-columns: 1fr;
    gap: var(--space-8);
  }

  .col-name {
    min-width: 0;
  }
}
</style>
