<script lang="ts" setup>
import { computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { adminSettingsPageExtensions, adminSidebarPageExtensions } from "../admin-extensions";
import NabeIcon from "@/components/NabeIcon.vue";
import nabeLogoUrl from "@/assets/icons/nabecms-logo-light.svg?url";
import { ICONS } from "@/utils/icons";
import { Avatar } from "@/components/ui/element-plus";

interface MenuItem {
  id: string;
  labelKey?: string;
  label?: string;
  icon: string;
  route: string;
  children?: MenuItem[];
}

interface Props {
  collapsed?: boolean;
  expandedItemIds: ReadonlySet<string>;
}

const { collapsed = false, expandedItemIds } = defineProps<Props>();

const emit = defineEmits<{
  navigate: [];
  toggleSection: [itemId: string];
  toggleUserMenu: [event: MouseEvent];
}>();

const route = useRoute();
const { t } = useI18n();

const builtInMenuItems: MenuItem[] = [
  {
    id: "dashboard",
    labelKey: "sidebar.dashboard",
    icon: ICONS.home,
    route: "/",
  },
  {
    id: "models",
    labelKey: "sidebar.models",
    icon: ICONS.database,
    route: "/models",
  },
  {
    id: "contents",
    labelKey: "sidebar.contents",
    icon: ICONS.folder,
    route: "/contents",
  },
  {
    id: "media",
    labelKey: "sidebar.media",
    icon: ICONS.image,
    route: "/media",
  },
  {
    id: "logs",
    labelKey: "sidebar.logs",
    icon: ICONS.history,
    route: "/logs",
  },
];

const authStore = useAuthStore();
const logSettingsChildren = computed<MenuItem[]>(() =>
  authStore.user?.roleId.includes("system.super-admin")
    ? [
        { id: "settings-email", labelKey: "emailSettings.title", icon: ICONS.settings, route: "/settings/email" },
        { id: "settings-logs", labelKey: "sidebar.settings_logs", icon: ICONS.history, route: "/settings/logs" },
      ]
    : [],
);
const builtInSettingsChildren: MenuItem[] = [
  {
    id: "settings-general",
    labelKey: "sidebar.settings_general",
    icon: ICONS.settings,
    route: "/settings",
  },
  {
    id: "settings-users",
    labelKey: "sidebar.settings_users",
    icon: ICONS.user,
    route: "/settings/users",
  },
  {
    id: "settings-roles",
    labelKey: "sidebar.settings_roles",
    icon: ICONS.shield,
    route: "/settings/roles",
  },
  {
    id: "settings-locales",
    labelKey: "sidebar.settings_locales",
    icon: ICONS.locale,
    route: "/settings/locales",
  },
  {
    id: "settings-api-keys",
    labelKey: "sidebar.settings_api_keys",
    icon: ICONS.apiKey,
    route: "/settings/api-keys",
  },
];

const extensionMenuItems: MenuItem[] = adminSidebarPageExtensions.map((page) => ({
  id: page.id,
  label: page.label,
  icon: page.icon,
  route: page.path,
}));

const extensionSettingsChildren: MenuItem[] = adminSettingsPageExtensions.map((page) => ({
  id: page.id,
  label: page.label,
  icon: page.icon,
  route: page.fullPath,
}));

const menuItems = computed<MenuItem[]>(() => [
  ...builtInMenuItems,
  ...extensionMenuItems,
  {
    id: "settings",
    labelKey: "sidebar.settings",
    icon: ICONS.settings,
    route: "/settings",
    children: [...builtInSettingsChildren, ...logSettingsChildren.value, ...extensionSettingsChildren],
  },
]);

/**
 * Resolve a visible menu label from either a translation key or host-owned text.
 */
const getItemLabel = (item: MenuItem): string => item.label ?? t(item.labelKey ?? "");

/**
 * Determine whether the current route matches a section or one of its descendants.
 */
const isActive = (itemRoute: string): boolean => route.path === itemRoute || route.path.startsWith(`${itemRoute}/`);

/**
 * Determine whether the current route exactly matches the provided path.
 */
const isCurrentPage = (itemRoute: string): boolean => route.path === itemRoute;

/**
 * Determine whether a submenu item should be visually marked as the current page.
 */
const isSubmenuItemActive = (itemRoute: string): boolean => isCurrentPage(itemRoute);

/**
 * Determine whether a parent item should be visually marked as active.
 */
const isParentActive = (item: MenuItem): boolean => {
  if (isActive(item.route)) return true;
  if (item.children) {
    return item.children.some((child) => isActive(child.route));
  }
  return false;
};

/**
 * Determine whether a submenu section is expanded.
 */
const isExpanded = (itemId: string): boolean => expandedItemIds.has(itemId);

/**
 * Return a stable DOM id for a submenu list.
 */
const getSubmenuId = (itemId: string): string => `sidebar-submenu-${itemId}`;

/**
 * Create a localized aria-label for submenu disclosure buttons.
 */
const getDisclosureLabel = (item: MenuItem): string =>
  t(isExpanded(item.id) ? "sidebar.collapse_section" : "sidebar.expand_section", { label: getItemLabel(item) });

/**
 * Resolve the current-page state for top-level links without duplicating the child "General" entry.
 */
const getTopLevelAriaCurrent = (item: MenuItem): "page" | undefined => {
  if (!isCurrentPage(item.route)) return undefined;
  if (item.children && !collapsed) return undefined;
  return "page";
};

/**
 * Emit a section toggle request to the parent shell.
 */
const handleToggleSection = (itemId: string) => {
  emit("toggleSection", itemId);
};

/**
 * Emit a navigation event so the parent shell can close transient UI.
 */
const handleNavigate = () => {
  emit("navigate");
};

/**
 * Emit a user menu toggle request with the original pointer event.
 */
const handleUserMenuToggle = (event: MouseEvent) => {
  emit("toggleUserMenu", event);
};
</script>

<template>
  <div class="sidebar-panel" :class="{ 'sidebar-panel--collapsed': collapsed }">
    <div class="sidebar-header">
      <div class="logo-section">
        <img class="logo-mark" :src="nabeLogoUrl" :alt="collapsed ? t('app.title') : ''" :aria-hidden="collapsed ? undefined : 'true'" />
        <h1 v-if="!collapsed" class="logo-text">{{ t("app.title") }}</h1>
      </div>
      <div class="sidebar-header__actions">
        <slot name="header-actions" />
      </div>
    </div>

    <nav class="sidebar-nav" :aria-label="t('sidebar.navigation')">
      <ul class="menu-list">
        <li
          v-for="item in menuItems"
          :key="item.id"
          class="menu-item"
          :class="{
            'menu-item--active': isParentActive(item),
            'menu-item--expanded': isExpanded(item.id),
          }"
        >
          <div class="menu-entry">
            <RouterLink
              :to="item.route"
              class="menu-link"
              :aria-current="getTopLevelAriaCurrent(item)"
              :aria-label="collapsed ? getItemLabel(item) : undefined"
              v-tooltip.right="{ value: getItemLabel(item), disabled: !collapsed }"
              @click="handleNavigate"
            >
              <NabeIcon :icon="item.icon" class="menu-icon" />
              <span v-if="!collapsed" class="menu-label">{{ getItemLabel(item) }}</span>
            </RouterLink>

            <button
              v-if="item.children && !collapsed"
              type="button"
              class="menu-disclosure"
              :aria-controls="getSubmenuId(item.id)"
              :aria-expanded="isExpanded(item.id)"
              :aria-label="getDisclosureLabel(item)"
              @click="handleToggleSection(item.id)"
            >
              <NabeIcon :icon="ICONS.chevronRight" class="menu-chevron" />
            </button>
          </div>

          <ul
            v-if="item.children && isExpanded(item.id) && !collapsed"
            :id="getSubmenuId(item.id)"
            class="submenu-list"
            :aria-label="t('sidebar.submenu', { label: getItemLabel(item) })"
          >
            <li v-for="child in item.children" :key="child.id" class="submenu-item" :class="{ 'submenu-item--active': isSubmenuItemActive(child.route) }">
              <RouterLink
                :to="child.route"
                class="submenu-link"
                :class="{ 'submenu-link--active': isSubmenuItemActive(child.route) }"
                :aria-current="isCurrentPage(child.route) ? 'page' : undefined"
                @click="handleNavigate"
              >
                <NabeIcon :icon="child.icon" class="submenu-icon" />
                <span class="submenu-label">{{ getItemLabel(child) }}</span>
              </RouterLink>
            </li>
          </ul>
        </li>
      </ul>
    </nav>

    <div class="sidebar-footer">
      <button type="button" class="user-trigger" :aria-label="t('sidebar.user_menu')" @click="handleUserMenuToggle($event)">
        <Avatar label="A" class="user-avatar" size="normal" shape="circle" />
        <div v-if="!collapsed" class="user-details">
          <span class="user-name">{{ t("user.name_sample") }}</span>
          <span class="user-role">{{ t("user.role_admin") }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.sidebar-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  color: inherit;
}

.sidebar-panel--collapsed {
  --sidebar-button-size: 44px;

  .sidebar-header {
    justify-content: center;
    gap: 0;
    padding-inline: 0;
  }

  .menu-item {
    display: flex;
    justify-content: center;
  }

  .menu-entry {
    margin-inline: 0;
  }

  .menu-link,
  .user-trigger {
    inline-size: var(--sidebar-button-size);
    block-size: var(--sidebar-button-size);
    flex: none;
    justify-content: center;
    padding: 0;
  }

  .sidebar-footer {
    padding-inline: 0;
  }
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 24px 24px 12px 24px;
  border-bottom: 1px solid rgb(var(--surface-0-rgb) / 0.12);
}

.logo-section {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.logo-mark {
  inline-size: 2rem;
  block-size: 2rem;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-text {
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
  color: var(--sidebar-text);
  white-space: nowrap;
}

.sidebar-header__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-track {
    background: rgb(var(--surface-0-rgb) / 0.05);
  }

  &::-webkit-scrollbar-thumb {
    background: rgb(var(--surface-0-rgb) / 0.2);
    border-radius: 2px;
  }
}

.menu-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.menu-item {
  margin-bottom: 4px;

  &--active .menu-entry,
  &--active .menu-entry:hover {
    background: var(--sidebar-active-bg);
    color: var(--sidebar-active-text);
  }

  &--expanded .menu-chevron {
    transform: rotate(90deg);
  }
}

.menu-entry {
  display: flex;
  align-items: stretch;
  margin: 0 12px;
  border-radius: 8px;
  position: relative;
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: var(--sidebar-hover-bg);
    color: var(--sidebar-text-strong);
  }

  &:focus-within {
    box-shadow: 0 0 0 2px var(--sidebar-focus-ring);
  }
}

.menu-link {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  color: inherit;
  text-decoration: none;
  border-radius: inherit;
  touch-action: manipulation;

  &:focus-visible {
    outline: none;
  }
}

.menu-icon {
  font-size: 1.1rem;
  min-width: 1.25rem;
}

.menu-label {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  font-size: 0.9rem;
}

.menu-disclosure {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  padding: 0 14px 0 8px;
  border: none;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  touch-action: manipulation;

  &:focus-visible {
    outline: none;
  }
}

.menu-chevron {
  font-size: 0.85rem;
  transition: transform 0.2s ease;
}

.submenu-list {
  list-style: none;
  margin: 0;
  padding: 4px 0 8px 0;
}

.submenu-link {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 12px 0 24px;
  padding: 10px 16px;
  border-radius: 12px;
  color: rgb(var(--surface-50-rgb) / 0.84);
  text-decoration: none;
  touch-action: manipulation;
  transition:
    background-color 0.2s ease,
    box-shadow 0.2s ease,
    color 0.2s ease;

  &:hover {
    background: var(--sidebar-hover-bg);
    color: var(--sidebar-text-strong);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--sidebar-focus-ring);
  }

  &--active {
    background: rgb(var(--primary-500-rgb) / 0.18);
    color: var(--sidebar-active-text);
  }
}

.submenu-icon {
  font-size: 0.9rem;
  width: 18px;
}

.submenu-label {
  font-size: 0.85rem;
  font-weight: 500;
}

.sidebar-footer {
  margin-top: auto;
  padding: 16px 24px 20px 24px;
  border-top: 1px solid rgb(var(--surface-0-rgb) / 0.12);
  display: flex;
  justify-content: center;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  touch-action: manipulation;

  &:focus-visible {
    outline: 2px solid rgb(var(--surface-50-rgb) / 0.5);
    outline-offset: 4px;
  }
}

.user-avatar {
  background: rgb(var(--primary-400-rgb) / 0.22);
  color: var(--sidebar-text-strong);
}

.user-details {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  text-align: left;
}

.user-name {
  font-weight: 600;
}

.user-role {
  font-size: 0.8rem;
  color: rgb(var(--surface-50-rgb) / 0.72);
}
</style>
