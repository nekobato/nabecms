<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
type ModelRow = {
  id: string;
  name: string;
  description: string | null;
  fieldsCount: number;
  updatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toModelRow = (input: unknown): ModelRow => {
  const record = isRecord(input) ? input : {};
  const idRaw = record.id;
  const nameRaw = record.name;
  const descriptionRaw = record.description;
  const updatedAtRaw = record.updatedAt;
  const fieldsCountRaw = record.fieldsCount;

  const id = typeof idRaw === "string" ? idRaw : String(idRaw ?? "");
  const name = typeof nameRaw === "string" ? nameRaw : String(nameRaw ?? "");
  const description = typeof descriptionRaw === "string" ? descriptionRaw : descriptionRaw == null ? null : String(descriptionRaw);
  const updatedAt = typeof updatedAtRaw === "string" ? updatedAtRaw : new Date().toISOString();
  const fieldsCount = typeof fieldsCountRaw === "number" && Number.isFinite(fieldsCountRaw) ? fieldsCountRaw : Number(fieldsCountRaw ?? 0) || 0;

  return {
    id,
    name,
    description,
    fieldsCount,
    updatedAt,
  };
};

const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();

const models = ref<ModelRow[]>([]);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  const year = Math.floor(day / 365);
  if (year >= 1) return t("time.years_ago", { n: year });
  const month = Math.floor(day / 30);
  if (month >= 1) return t("time.months_ago", { n: month });
  if (day >= 1) return t("time.days_ago", { n: day });
  if (hour >= 1) return t("time.hours_ago", { n: hour });
  if (min >= 1) return t("time.minutes_ago", { n: min });
  return t("time.just_now");
};

const createModel = () => router.push("/models/create");

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
    models.value = items.map((item) => toModelRow(item));
  } catch (error) {
    console.error("Failed to load models", error);
    errorMessage.value = t("models.list.error");
  } finally {
    loading.value = false;
  }
};

onMounted(fetchModels);
</script>

<template>
  <div class="models-list">
    <PageSectionHeader :title="t('models.list.title')">
      <template #actions>
        <Button :label="t('models.list.create')" icon="lucide:plus" @click="createModel" />
      </template>
    </PageSectionHeader>

    <Card class="models-list__card">
      <template #content>
        <div class="owned-data-view">
          <div class="list-head">
            <div class="col col-name">{{ t("models.list.head_name") }}</div>
            <div class="col col-updated">{{ t("models.list.head_updated") }}</div>
            <div class="col col-fields">{{ t("models.list.head_fields") }}</div>
          </div>

          <div v-if="loading" class="row loading"><NabeIcon :icon="ICONS.loading" class="mr-2" spin /> {{ t("models.list.loading") }}</div>

          <div v-else-if="errorMessage" class="row empty"><NabeIcon :icon="ICONS.error" class="mr-2" /> {{ errorMessage }}</div>

          <div v-else-if="models.length === 0" class="row empty"><NabeIcon :icon="ICONS.box" class="mr-2" /> {{ t("models.list.empty") }}</div>

          <template v-else>
            <RouterLink v-for="m in models" :key="m.id" class="row item" :to="`/models/${encodeResourceId(m.id)}`">
              <div class="col col-name">
                <div class="name">{{ m.name }}</div>
                <div class="desc">{{ m.description }}</div>
              </div>
              <div class="col col-updated" :data-label="t('models.list.head_updated')">{{ formatRelative(m.updatedAt) }}</div>
              <div class="col col-fields" :data-label="t('models.list.head_fields')">{{ m.fieldsCount }}</div>
            </RouterLink>
          </template>
        </div>
      </template>
    </Card>
  </div>
</template>

<style lang="scss" scoped>
.models-list {
  padding: var(--space-24);
}

.models-list__card :deep(.el-card__body) {
  padding: 0;
}

/* Head */
.list-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px 160px;
  padding: var(--space-12) var(--space-16);
  color: var(--surface-600);
  font-weight: 600;
}

/* Rows */
.row.item,
.row.loading,
.row.empty {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px 160px;
  gap: var(--space-8);
  align-items: center;
  padding: var(--space-16) var(--space-16);
}

.row.item {
  cursor: pointer;
  color: inherit;
  text-decoration: none;
  touch-action: manipulation;
  transition: background-color 0.15s ease-in-out;
  min-width: 0;
}

.row.item + .row.item {
  border-top: 1px solid var(--surface-200);
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
  word-break: break-word;
}
.col-name .desc {
  color: var(--surface-600);
  font-size: var(--font-14);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  overflow: hidden;
}

.col-fields {
  color: var(--surface-900);
  text-align: right;
  font-weight: 600;
}

.col-updated {
  color: var(--surface-700);
}

@media (max-width: 1024px) {
  .list-head,
  .row.item,
  .row.loading,
  .row.empty {
    grid-template-columns: minmax(0, 1fr) 1fr 120px;
  }
}

@media (max-width: 640px) {
  .list-head {
    display: none;
  }

  .row.loading,
  .row.empty {
    grid-template-columns: 1fr;
    gap: var(--space-8);
  }

  .row.item {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name fields"
      ". updated";
    row-gap: var(--space-12);
  }

  .col-name {
    grid-area: name;
    min-width: 0;
  }

  .col-updated {
    grid-area: updated;
    text-align: right;
  }

  .col-fields {
    grid-area: fields;
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
    color: #0f172a;
  }

  .col-updated,
  .col-fields {
    font-size: var(--font-12);
  }

  .col-updated::before,
  .col-fields::before {
    content: attr(data-label);
    color: #64748b;
    font-weight: 600;
    margin-right: var(--space-4);
  }
}
</style>
