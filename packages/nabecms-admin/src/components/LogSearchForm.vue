<script setup lang="ts">
import { reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElDatePicker, ElInput, ElOption, ElSelect } from "element-plus";
import Button from "@/components/NabeButton.vue";

const { mode } = defineProps<{ mode: "audit" | "auth" }>();
const emit = defineEmits<{ search: [query: Record<string, string>] }>();
const { t } = useI18n();
const fields = reactive({ from: "", to: "", value: "all", id: "" });
const error = ref(false);
const actions = ["create", "update", "publish", "unpublish", "restore_revision", "delete"];
const results = ["success", "failed", "locked"];
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Apply dates as local calendar days; preserve daylight-saving transitions. */
const submit = () => {
  const from = fields.from ? new Date(`${fields.from}T00:00:00`) : null;
  const to = fields.to ? new Date(`${fields.to}T00:00:00`) : null;
  to?.setHours(23, 59, 59, 999);
  error.value = Boolean((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime())) || (from && to && from > to));
  if (error.value) return;
  const query: Record<string, string> = {};
  if (from) query.dateFrom = from.toISOString();
  if (to) query.dateTo = to.toISOString();
  if (fields.value !== "all") query[mode === "audit" ? "action" : "result"] = fields.value;
  if (fields.id.trim()) query[mode === "audit" ? "targetId" : "userId"] = fields.id.trim();
  emit("search", query);
};

const clear = () => {
  Object.assign(fields, { from: "", to: "", value: "all", id: "" });
  error.value = false;
  emit("search", {});
};
</script>

<template>
  <form class="filters" :aria-label="t('logs.filters.title')" @submit.prevent="submit" @input="error = false">
    <div class="field">
      <label :for="`${mode}-from`">{{ t("logs.filters.from") }}</label>
      <ElDatePicker
        :id="`${mode}-from`"
        v-model="fields.from"
        type="date"
        value-format="YYYY-MM-DD"
        :name="`${mode}-from`"
        :aria-describedby="`${mode}-date-help`"
        :aria-invalid="error"
        :placeholder="t('logs.filters.unlimited')"
      />
    </div>
    <div class="field">
      <label :for="`${mode}-to`">{{ t("logs.filters.to") }}</label>
      <ElDatePicker
        :id="`${mode}-to`"
        v-model="fields.to"
        type="date"
        value-format="YYYY-MM-DD"
        :name="`${mode}-to`"
        :aria-describedby="`${mode}-date-help`"
        :aria-invalid="error"
        :placeholder="t('logs.filters.unlimited')"
      />
    </div>
    <div class="field">
      <label :for="`${mode}-value`">{{ t(mode === "audit" ? "logs.audit.action" : "logs.auth.result") }}</label>
      <ElSelect :id="`${mode}-value`" v-model="fields.value" :name="`${mode}-value`">
        <ElOption value="all" :label="t('logs.filters.all')" />
        <ElOption
          v-for="value in mode === 'audit' ? actions : results"
          :key="value"
          :value="value"
          :label="t(`logs.${mode === 'audit' ? 'operations' : 'results'}.${value}`)"
        />
      </ElSelect>
    </div>
    <div class="field id-field">
      <label :for="`${mode}-id`">{{ t(mode === "audit" ? "logs.filters.target_id" : "logs.filters.user_id") }}</label>
      <ElInput :id="`${mode}-id`" v-model="fields.id" :name="`${mode}-id`" :placeholder="t('logs.filters.exact_id')" clearable autocomplete="off" />
    </div>
    <div class="filter-actions">
      <Button type="submit" severity="primary" icon="lucide:search" :label="t('logs.filters.search')" />
      <Button :label="t('logs.filters.clear')" @click="clear" />
    </div>
    <p :id="`${mode}-date-help`" class="date-help" :role="error ? 'alert' : undefined">
      {{ error ? t("logs.filters.invalid_dates") : t("logs.filters.timezone", { timezone }) }}
    </p>
  </form>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-16);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-width: 0;
}
.field label {
  font-size: var(--font-14);
  font-weight: 500;
}
.field :deep(.el-date-editor),
.field :deep(.el-select) {
  width: 100%;
  min-width: 0;
}
.id-field {
  grid-column: span 2;
}
.filter-actions {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: var(--space-8);
}
.filter-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.date-help {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--font-12);
}
.date-help[role="alert"] {
  color: var(--el-color-danger);
}
@media (max-width: 640px) {
  .filters {
    grid-template-columns: minmax(0, 1fr);
  }
  .id-field {
    grid-column: auto;
  }
  .filter-actions {
    justify-content: flex-start;
  }
}
</style>
