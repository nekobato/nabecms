<script lang="ts" setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElConfigProvider } from "element-plus";
import en from "element-plus/es/locale/lang/en";
import ja from "element-plus/es/locale/lang/ja";
import AppSidebar from "./components/AppSidebar.vue";
import { useAuthStore } from "./stores/auth";

const route = useRoute();
const auth = useAuthStore();
const { locale } = useI18n();
const elementLocale = computed(() => (String(locale.value).startsWith("ja") ? ja : en));

const isAuthPage = computed(() => {
  return route.path.startsWith("/auth");
});

const showDbAlert = computed(() => auth.bootstrapError?.code === "DATABASE_NOT_CONFIGURED" || auth.bootstrapError?.code === "DATABASE_NOT_INITIALIZED");
const dbAlertMessage = computed(() => {
  const code = auth.bootstrapError?.code;
  const detail = auth.bootstrapError?.message;
  if (!code) return "";
  if (code === "DATABASE_NOT_CONFIGURED") {
    return detail ?? "DB が設定されていないようです。wrangler で D1 バインディングを設定してから再度試してください。";
  }
  if (code === "DATABASE_NOT_INITIALIZED") {
    return detail ?? "D1 にテーブルが存在しないようです。マイグレーションを実行してください。";
  }
  return detail ?? "システム初期化に失敗しました。";
});
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <div class="app-layout" :class="{ 'app-layout--auth': isAuthPage }">
      <AppSidebar v-if="!isAuthPage && !showDbAlert" />
      <main class="main-content" :class="{ 'main-content--auth': isAuthPage, 'main-content--with-sidebar': !isAuthPage && !showDbAlert }">
        <div v-if="showDbAlert" class="db-alert" role="alert">
          <div class="db-alert__card">
            <h1 class="db-alert__title">データベースが未設定です</h1>
            <p class="db-alert__body">{{ dbAlertMessage }}</p>
            <p class="db-alert__hint">D1 バインディング設定とマイグレーションを確認してから再読み込みしてください。</p>
          </div>
        </div>
        <router-view v-else />
      </main>
    </div>
  </ElConfigProvider>
</template>

<style lang="scss" scoped>
:global(:root) {
  --sidebar-width: 200px;
  --sidebar-width-collapsed: 77px;
  --sidebar-gap: 24px;
  --sidebar-content-gap: 24px;
  --sidebar-main-offset: calc(var(--sidebar-width) + var(--sidebar-gap));
  --sidebar-main-offset-collapsed: calc(var(--sidebar-width-collapsed) + var(--sidebar-gap));
  --mobile-sidebar-gap: 8px;
  --mobile-sidebar-bar-height: 48px;
  --mobile-sidebar-main-offset: calc(var(--mobile-sidebar-bar-height) + (var(--mobile-sidebar-gap) * 2) + env(safe-area-inset-bottom));
}

.app-layout {
  display: flex;
  height: 100vh;
  background-color: var(--app-bg);
  color: var(--app-text);

  &--auth {
    .main-content {
      margin-left: 0;
    }
  }

  .main-content {
    flex: 1;
    margin-left: var(--sidebar-main-offset);
    overflow-y: auto;
    background: var(--app-main-panel-bg);
    transition: margin-left 0.3s ease;

    &--auth {
      margin-left: 0;
      background: transparent;
    }

    @media (max-width: 768px) {
      margin-left: 0;
    }

    &--with-sidebar {
      @media (max-width: 768px) {
        padding-bottom: var(--mobile-sidebar-main-offset);
      }
    }
  }
}

.db-alert {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  background: var(--app-db-alert-bg);

  &__card {
    max-width: 520px;
    width: 100%;
    padding: 32px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 16px;
    box-shadow: none;
    text-align: center;
  }

  &__title {
    margin: 0 0 12px;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--app-text-strong);
  }

  &__body {
    margin: 0 0 8px;
    color: var(--app-text);
    line-height: 1.6;
  }

  &__hint {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 0.875rem;
  }
}

// Handle collapsed sidebar
.app-layout:has(.sidebar--collapsed) .main-content {
  margin-left: var(--sidebar-main-offset-collapsed);

  @media (max-width: 768px) {
    margin-left: 0;
  }
}
</style>
