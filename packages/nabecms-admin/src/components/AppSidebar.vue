<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Popover } from "@/components/ui/element-plus";
import AppSidebarPanel from "./AppSidebarPanel.vue";
import LanguageSwitcherDialog from "./LanguageSwitcherDialog.vue";
import { useUiStore } from "../stores/ui";
import NabeIcon from "@/components/NabeIcon.vue";
import { ICONS } from "@/utils/icons";

import { Drawer } from "@/components/ui/element-plus";
type PopoverHandle = {
  hide?: () => void;
  toggle?: (event: Event) => void;
};

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const { t } = useI18n();

const expandedItems = ref(new Set(["settings"]));
const isMobileViewport = ref(false);
const isPanelCollapsed = ref(ui.sidebarCollapsed);

const MOBILE_MEDIA_QUERY = "(max-width: 768px)";
let mediaQueryList: MediaQueryList | null = null;

const languagePopover = ref<PopoverHandle | null>(null);
const languageDialogRef = ref<InstanceType<typeof LanguageSwitcherDialog> | null>(null);

/**
 * Toggle the desktop sidebar collapsed state.
 */
const toggleCollapse = () => {
  ui.toggleSidebar();
};

/**
 * Reveal expanded panel content after the sidebar width transition completes.
 */
const handleSidebarTransitionEnd = (event: TransitionEvent) => {
  if (event.target !== event.currentTarget || event.propertyName !== "width" || ui.sidebarCollapsed) return;

  isPanelCollapsed.value = false;
};

/**
 * Toggle the expanded state of a sidebar section.
 */
const toggleExpanded = (itemId: string) => {
  if (expandedItems.value.has(itemId)) {
    expandedItems.value.delete(itemId);
    return;
  }

  expandedItems.value.add(itemId);
};

/**
 * Toggle the user action popover.
 */
const toggleLanguagePopover = (event: Event) => {
  languagePopover.value?.toggle?.(event);
};

/**
 * Close the user action popover if it is open.
 */
const closeLanguagePopover = () => {
  languagePopover.value?.hide?.();
};

/**
 * Close the mobile drawer and any transient overlays anchored to it.
 */
const closeMobileSidebar = () => {
  ui.closeMobileSidebar();
  closeLanguagePopover();
};

/**
 * Toggle the mobile drawer visibility.
 */
const toggleMobileSidebar = () => {
  ui.toggleMobileSidebar();
  closeLanguagePopover();
};

/**
 * Synchronize viewport-dependent sidebar behavior.
 */
const syncViewportState = (matches: boolean) => {
  isMobileViewport.value = matches;

  if (!matches) {
    closeMobileSidebar();
  }
};

/**
 * Handle media query transitions for the sidebar layout.
 */
const handleMediaChange = (event: MediaQueryListEvent) => {
  syncViewportState(event.matches);
};

/**
 * Handle navigation from the sidebar, closing transient mobile UI afterward.
 */
const handleNavigate = () => {
  closeLanguagePopover();
  if (isMobileViewport.value) {
    closeMobileSidebar();
  }
};

/**
 * Open the language switcher dialog from the user menu.
 */
const handleLanguageClick = () => {
  closeMobileSidebar();
  languageDialogRef.value?.openDialog();
};

/**
 * Navigate to the logout route from the user menu.
 */
const handleLogoutClick = () => {
  closeMobileSidebar();
  void router.push("/auth/logout");
};

const sidebarClasses = computed(() => ({
  sidebar: true,
  "sidebar--collapsed": ui.sidebarCollapsed,
}));

watch(
  () => route.fullPath,
  () => {
    if (isMobileViewport.value) {
      closeMobileSidebar();
    }
  },
);

watch(
  () => ui.sidebarCollapsed,
  (collapsed) => {
    if (collapsed) {
      isPanelCollapsed.value = true;
    }
  },
  { flush: "sync" },
);

onMounted(() => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

  mediaQueryList = window.matchMedia(MOBILE_MEDIA_QUERY);
  syncViewportState(mediaQueryList.matches);

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleMediaChange);
    return;
  }

  if (typeof mediaQueryList.addListener === "function") {
    mediaQueryList.addListener(handleMediaChange);
  }
});

onBeforeUnmount(() => {
  if (!mediaQueryList) return;

  if (typeof mediaQueryList.removeEventListener === "function") {
    mediaQueryList.removeEventListener("change", handleMediaChange);
  } else if (typeof mediaQueryList.removeListener === "function") {
    mediaQueryList.removeListener(handleMediaChange);
  }
});
</script>

<template>
  <div v-if="isMobileViewport" class="sidebar-mobile-bar">
    <button
      type="button"
      class="mobile-sidebar-toggle"
      aria-controls="app-sidebar-drawer"
      :aria-expanded="ui.mobileSidebarOpen"
      :aria-label="t('sidebar.open_navigation')"
      @click="toggleMobileSidebar"
    >
      <span class="mobile-sidebar-toggle__icon">
        <NabeIcon :icon="ICONS.menu" />
      </span>
    </button>
  </div>

  <Drawer
    v-if="isMobileViewport"
    id="app-sidebar-drawer"
    v-model:visible="ui.mobileSidebarOpen"
    class="sidebar-drawer"
    position="left"
    :showCloseIcon="false"
    :modal="true"
    :dismissableMask="true"
    :closeOnEscape="true"
    :blockScroll="true"
    :style="{ width: 'min(var(--sidebar-width), calc(100vw - var(--mobile-sidebar-gap)))' }"
  >
    <template #container>
      <div class="sidebar sidebar--mobile">
        <AppSidebarPanel
          :expanded-item-ids="expandedItems"
          @navigate="handleNavigate"
          @toggle-section="toggleExpanded"
          @toggle-user-menu="toggleLanguagePopover"
        />
      </div>
    </template>
  </Drawer>

  <aside v-else :class="sidebarClasses" @transitionend="handleSidebarTransitionEnd">
    <AppSidebarPanel
      :collapsed="isPanelCollapsed"
      :expanded-item-ids="expandedItems"
      @navigate="handleNavigate"
      @toggle-section="toggleExpanded"
      @toggle-user-menu="toggleLanguagePopover"
    >
      <template #header-actions>
        <button
          type="button"
          class="sidebar-collapse-toggle"
          :aria-label="ui.sidebarCollapsed ? t('sidebar.expand') : t('sidebar.collapse')"
          @click="toggleCollapse"
        >
          <NabeIcon :icon="ui.sidebarCollapsed ? ICONS.chevronRight : ICONS.chevronLeft" />
        </button>
      </template>
    </AppSidebarPanel>
  </aside>

  <Popover ref="languagePopover" class="language-popover" :showCloseIcon="false" :width="200">
    <div class="user-menu">
      <button type="button" class="user-menu__item" @click="handleLanguageClick">
        <NabeIcon :icon="ICONS.locale" class="user-menu__icon" />
        <span class="user-menu__label">{{ t("sidebar.language") }}</span>
      </button>
      <button type="button" class="user-menu__item" @click="handleLogoutClick">
        <NabeIcon :icon="ICONS.logout" class="user-menu__icon" />
        <span class="user-menu__label">{{ t("sidebar.logout") }}</span>
      </button>
    </div>
  </Popover>

  <LanguageSwitcherDialog ref="languageDialogRef">
    <template #trigger></template>
  </LanguageSwitcherDialog>
</template>

<style lang="scss" scoped>
.sidebar {
  width: var(--sidebar-width);
  height: calc(100vh - (var(--sidebar-gap) * 2));
  margin: var(--sidebar-gap);
  border-radius: 16px;
  border: 1px solid var(--sidebar-border);
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  position: fixed;
  left: 0;
  top: 0;
  z-index: 1000;
  transition:
    width 0.3s ease,
    box-shadow 0.3s ease;
  box-shadow: var(--shadow-sidebar);
  overflow: visible;

  &--collapsed {
    width: var(--sidebar-width-collapsed);
  }

  &--mobile {
    width: 100%;
    height: 100%;
    margin: 0;
    border-radius: 0 20px 20px 0;
    position: relative;
    box-shadow: none;
    overflow: hidden;
  }
}

.sidebar-mobile-bar {
  position: fixed;
  bottom: calc(var(--mobile-sidebar-gap) + env(safe-area-inset-bottom));
  left: var(--mobile-sidebar-gap);
  z-index: 980;
  pointer-events: none;
}

.mobile-sidebar-toggle {
  width: var(--mobile-sidebar-button-size, var(--mobile-sidebar-bar-height));
  height: var(--mobile-sidebar-button-size, var(--mobile-sidebar-bar-height));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--sidebar-mobile-border);
  border-radius: 50%;
  background: var(--sidebar-mobile-bg);
  color: var(--sidebar-text-strong);
  box-shadow: var(--shadow-mobile);
  backdrop-filter: blur(16px);
  cursor: pointer;
  pointer-events: auto;
  touch-action: manipulation;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: var(--shadow-mobile-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--sidebar-contrast-ring);
    outline-offset: 3px;
  }
}

.mobile-sidebar-toggle__icon {
  width: 100%;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  color: var(--sidebar-text-strong);
  flex-shrink: 0;
}

.mobile-sidebar-toggle__icon i {
  font-size: 0.95rem;
}

.sidebar-collapse-toggle {
  position: absolute;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(135deg, var(--primary-500) 0%, var(--primary-700) 100%);
  color: var(--surface-0);
  box-shadow: var(--shadow-sidebar-action);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
  touch-action: manipulation;

  &:hover {
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid var(--sidebar-contrast-ring);
    outline-offset: 3px;
  }

  i {
    font-size: 0.9rem;
  }
}

:global(.sidebar-drawer.el-drawer) {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}

:global(.sidebar-drawer .el-drawer__body) {
  padding: 0 !important;
  border: none !important;
  background: transparent !important;
}

.language-popover {
  padding: var(--space-12) var(--space-16);
  border-radius: var(--radius-16);
  border: 1px solid var(--sidebar-popover-border);
  background: var(--sidebar-popover-bg);
  color: var(--surface-900);
  box-shadow: var(--shadow-popover);
}

.user-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: 100%;
  min-width: 0;
}

.user-menu__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  width: 100%;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    background 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: rgb(var(--primary-500-rgb) / 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgb(var(--primary-500-rgb) / 0.3);
    outline-offset: 2px;
  }
}

.user-menu__icon {
  font-size: 1rem;
  color: var(--primary-700);
}

.user-menu__label {
  flex: 1;
  min-width: 0;
  font-size: var(--font-13);
  font-weight: 500;
  color: var(--surface-900);
}

@media (min-width: 769px) {
  .sidebar-mobile-bar {
    display: none;
  }
}
</style>
