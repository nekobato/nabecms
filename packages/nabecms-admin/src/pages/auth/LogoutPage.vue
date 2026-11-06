<script lang="ts" setup>
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useI18n } from "vue-i18n";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";

import { Card } from "@/components/ui/element-plus";
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

onMounted(async () => {
  try {
    await auth.logout();
  } finally {
    await router.replace({ name: "login" });
  }
});
</script>

<template>
  <div class="auth-shell">
    <div class="auth-shell__panel auth-shell__panel--xs">
      <Card class="auth-shell__card logout-card">
        <template #content>
          <div class="logout-card__content" role="status" aria-live="polite">
            <span class="auth-shell__symbol" aria-hidden="true">
              <NabeIcon :icon="ICONS.logout" />
            </span>
            <h1 class="logout-card__title">{{ t("auth.logout.title") }}</h1>
            <p class="logout-card__message">{{ t("auth.logout.message") }}</p>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.logout-card__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-16, 1rem);
  text-align: center;
}

.logout-card__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--surface-900);
}

.logout-card__message {
  margin: 0;
  font-size: 0.95rem;
  color: var(--app-text);
  line-height: 1.6;
}
</style>
