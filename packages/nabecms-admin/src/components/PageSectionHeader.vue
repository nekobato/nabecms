<script setup lang="ts">
import { computed, getCurrentInstance, useSlots } from "vue";
import { ElBreadcrumb, ElBreadcrumbItem } from "element-plus";
import type { RouteLocationRaw, Router } from "vue-router";
import NabeIcon from "@/components/NabeIcon.vue";

type BreadcrumbItem = {
  label: string;
  to?: RouteLocationRaw;
  url?: string;
  target?: string;
};

interface Props {
  title: string;
  titleIcon?: string | null;
  description?: string | null;
  hint?: string | null;
  breadcrumbModel?: BreadcrumbItem[] | null;
}

const props = withDefaults(defineProps<Props>(), {
  titleIcon: null,
  description: null,
  hint: null,
  breadcrumbModel: null,
});

const slots = useSlots();

const hasBreadcrumb = computed(() => Array.isArray(props.breadcrumbModel) && props.breadcrumbModel.length > 0);
const hasActions = computed(() => Boolean(slots.actions));
const hasBottom = computed(() => Boolean(slots.bottom));
const hasDetails = computed(() => Boolean(slots.default));
const router = getCurrentInstance()?.appContext.config.globalProperties.$router as Router | undefined;

/** Resolve a link href even when this header is rendered in an isolated test. */
const resolveBreadcrumbHref = (item: BreadcrumbItem): string => {
  if (item.url) return item.url;
  if (router && item.to) return router.resolve(item.to).href;
  return typeof item.to === "string" ? item.to : "#";
};

/** Use client-side routing when a router is available. */
const navigateToBreadcrumb = (event: MouseEvent, item: BreadcrumbItem): void => {
  if (!router || !item.to) return;
  event.preventDefault();
  void router.push(item.to);
};
</script>

<template>
  <header class="page-section-header">
    <ElBreadcrumb v-if="hasBreadcrumb" class="page-section-header__breadcrumb">
      <ElBreadcrumbItem v-for="item in props.breadcrumbModel ?? []" :key="item.label">
        <a v-if="item.to" :href="resolveBreadcrumbHref(item)" @click="navigateToBreadcrumb($event, item)">
          <span class="page-section-header__breadcrumb-label">{{ item.label }}</span>
        </a>
        <a v-else-if="item.url" :href="item.url" :target="item.target">
          <span class="page-section-header__breadcrumb-label">{{ item.label }}</span>
        </a>
        <span v-else class="page-section-header__breadcrumb-label">
          {{ item.label }}
        </span>
      </ElBreadcrumbItem>
    </ElBreadcrumb>

    <div class="page-section-header__main">
      <div class="page-section-header__lead">
        <h1 class="page-section-header__title">
          <NabeIcon v-if="titleIcon" :icon="titleIcon" class="page-section-header__title-icon" />
          <span>{{ title }}</span>
        </h1>
        <div v-if="hasDetails" class="page-section-header__details">
          <slot />
        </div>
      </div>

      <div v-if="hasActions" class="page-section-header__actions">
        <slot name="actions" />
      </div>
    </div>

    <div v-if="hasBottom" class="page-section-header__bottom">
      <slot name="bottom" />
    </div>
  </header>
</template>

<style lang="scss" scoped>
.page-section-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  margin-bottom: var(--space-24);
}

.page-section-header__breadcrumb {
  margin: 0;
}

.page-section-header__main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-16);
}

.page-section-header__lead {
  min-width: 0;
}

.page-section-header__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-12);
  margin: 0;
  font-size: var(--font-32);
  font-weight: 700;
  color: var(--surface-900);
}

.page-section-header__title-icon {
  flex: 0 0 auto;
  color: var(--surface-700);
  font-size: 0.85em;
  line-height: 1;
}

.page-section-header__details {
  margin-top: var(--space-12);
}

.page-section-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-8);
  flex-wrap: wrap;
}

.page-section-header__bottom {
  margin-top: var(--space-4);
}

@media (max-width: 768px) {
  .page-section-header__main {
    flex-direction: column;
    align-items: stretch;
  }

  .page-section-header__actions {
    justify-content: flex-start;
  }
}
</style>
