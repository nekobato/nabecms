<script lang="ts" setup>
import { Icon } from "@iconify/vue";
import type { FieldType, FieldTypeItem } from "./types";

const props = defineProps<{
  fieldTypes: FieldTypeItem[];
}>();

const emit = defineEmits<{
  (e: "select", type: FieldType): void;
}>();
</script>

<template>
  <div class="afd-grid">
    <button v-for="item in props.fieldTypes" :key="item.id" type="button" class="afd-card" @click="emit('select', item.id)">
      <div class="afd-card-icon">
        <Icon :icon="item.icon" class="icon" />
      </div>
      <div class="afd-card-text">
        <div class="name">{{ item.label }}</div>
        <div class="desc">{{ item.desc }}</div>
      </div>
    </button>
  </div>
</template>

<style scoped lang="scss">
.afd-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-12);

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
}

.afd-card {
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: center;
  gap: var(--space-12);
  padding: var(--space-12);
  border: 1px solid var(--surface-200);
  border-radius: 8px;
  background: var(--surface-0);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease,
    background 0.12s ease;

  &:hover {
    border-color: var(--primary-200);
    box-shadow: 0 0 0 3px rgb(var(--primary-500-rgb) / 0.15);
  }
}

.afd-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--blue-50);

  .icon {
    width: 20px;
    height: 20px;
    color: var(--blue-700);
  }
}

.afd-card-text {
  .name {
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--surface-900);
  }

  .desc {
    margin-top: var(--space-4);
    font-size: var(--font-13);
    color: var(--surface-600);
  }
}
</style>
