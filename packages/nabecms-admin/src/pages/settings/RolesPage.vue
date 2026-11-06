<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Textarea } from "@/components/ui/element-plus";
import { Checkbox } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const authStore = useAuthStore();
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

interface RolePermissions {
  allow: string[];
}

interface RoleItem {
  id: string;
  name: string;
  description: string | null;
  permissions: RolePermissions;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

type RoleFormState = {
  name: string;
  description: string;
  allPermissions: boolean;
  permissionMap: Record<string, boolean>;
  preservedPermissions: string[];
};

type EntryPermissionAction = "create" | "read" | "update" | "delete" | "publish";
type AdminPermissionAction = "read" | "write";

type PermissionMatrixRow<Action extends string> = {
  key: string;
  labelKey: string;
  descriptionKey?: string;
  permissions: Partial<Record<Action, readonly string[]>>;
};

type PermissionSummaryGroup = {
  label: string;
  actions: string[];
};

const roles = ref<RoleItem[]>([]);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const dialogVisible = ref(false);
const dialogSubmitting = ref(false);
const editingRoleId = ref<string | null>(null);
const deleteInProgress = ref<Record<string, boolean>>({});

const formState = reactive<RoleFormState>({
  name: "",
  description: "",
  allPermissions: false,
  permissionMap: {},
  preservedPermissions: [],
});

const breadcrumbModel = computed(() => [{ label: t("settings.title"), to: "/settings", url: resolveUrl("/settings") }, { label: t("settings.roles.title") }]);

const entryActions = ["create", "read", "update", "delete", "publish"] as const satisfies readonly EntryPermissionAction[];
const adminActions = ["read", "write"] as const satisfies readonly AdminPermissionAction[];

const entryPermissionRows: readonly PermissionMatrixRow<EntryPermissionAction>[] = [
  {
    key: "entries",
    labelKey: "settings.roles.permission_resource_entries",
    descriptionKey: "settings.roles.permission_resource_entries_description",
    permissions: {
      create: ["entries:*:create"],
      read: ["entries:*:read"],
      update: ["entries:*:update"],
      delete: ["entries:*:delete"],
      publish: ["entries:*:publish"],
    },
  },
] as const;

const adminPermissionRows: readonly PermissionMatrixRow<AdminPermissionAction>[] = [
  {
    key: "model_schema",
    labelKey: "settings.roles.permission_resource_model_schema",
    descriptionKey: "settings.roles.permission_resource_model_schema_description",
    permissions: {
      read: ["models:*:read"],
      write: ["models:*:write"],
    },
  },
  {
    key: "media",
    labelKey: "settings.roles.permission_resource_media",
    permissions: {
      read: ["media:*:read"],
      write: ["media:*:write"],
    },
  },
  {
    key: "locales",
    labelKey: "settings.roles.permission_resource_locales",
    permissions: {
      read: ["locales:*:read"],
      write: ["locales:*:write"],
    },
  },
  {
    key: "users",
    labelKey: "settings.roles.permission_resource_users",
    permissions: {
      read: ["users:*:read"],
      write: ["users:*:write"],
    },
  },
  {
    key: "invites",
    labelKey: "settings.roles.permission_resource_invites",
    permissions: {
      write: ["users:invite:write"],
    },
  },
  {
    key: "roles",
    labelKey: "settings.roles.permission_resource_roles",
    permissions: {
      read: ["roles:*:read"],
      write: ["roles:*:write"],
    },
  },
  {
    key: "api_keys",
    labelKey: "settings.roles.permission_resource_api_keys",
    permissions: {
      read: ["api_keys:*:read"],
      write: ["api_keys:*:write"],
    },
  },
  {
    key: "logs",
    labelKey: "settings.roles.permission_resource_logs",
    permissions: {
      read: ["logs:*:read"],
    },
  },
  {
    key: "media_settings",
    labelKey: "settings.roles.permission_resource_media_settings",
    permissions: {
      read: ["settings:media:read"],
      write: ["settings:media:write"],
    },
  },
] as const;

/**
 * Normalize permission values by trimming and removing duplicates.
 * @param values - Raw permission strings
 * @returns Normalized unique permission list
 */
const normalizePermissionList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
};

/**
 * Escape a permission pattern segment for RegExp usage.
 * @param value - Raw pattern segment
 * @returns Escaped segment
 */
const escapeRegExp = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Check whether a saved permission pattern grants a concrete permission.
 * @param pattern - Saved permission pattern
 * @param target - Concrete permission value
 * @returns True when the pattern grants the target permission
 */
const matchesPermissionPattern = (pattern: string, target: string): boolean => {
  if (pattern === "*") return true;
  const source = pattern
    .split("*")
    .map((segment) => escapeRegExp(segment))
    .join(".*");
  return new RegExp(`^${source}$`).test(target);
};

const allPermissionRows = [...entryPermissionRows, ...adminPermissionRows] as readonly PermissionMatrixRow<string>[];
const matrixPermissionValues = allPermissionRows.flatMap((row) => Object.values(row.permissions).flatMap((permissions) => [...(permissions ?? [])]));
const deprecatedPermissionValues = new Set<string>(["users:invite:read"]);

/**
 * Check whether a permission value is no longer represented by active role controls.
 * @param permission - Permission value
 * @returns True when the permission is deprecated
 */
const isDeprecatedPermission = (permission: string): boolean =>
  deprecatedPermissionValues.has(permission) || permission === "webhooks" || permission.startsWith("webhooks:");

/**
 * Normalize permission values and drop deprecated permissions.
 * @param values - Raw permission strings
 * @returns Active normalized permission list
 */
const normalizeActivePermissionList = (values: string[]): string[] =>
  normalizePermissionList(values).filter((permission) => !isDeprecatedPermission(permission));

/**
 * Build a stable form key for one permission matrix cell.
 * @param rowKey - Permission row key
 * @param action - Permission action
 * @returns Stable matrix cell key
 */
const permissionCellKey = (rowKey: string, action: string): string => `${rowKey}:${action}`;

/**
 * Build an HTML id for a permission matrix checkbox.
 * @param rowKey - Permission row key
 * @param action - Permission action
 * @returns Stable input id
 */
const permissionCellInputId = (rowKey: string, action: string): string => `perm-${rowKey}-${action}`;

/**
 * Build a stable test id for a permission matrix checkbox.
 * @param rowKey - Permission row key
 * @param action - Permission action
 * @returns Stable test id
 */
const permissionCellTestId = (rowKey: string, action: string): string => `permission-cell-${rowKey}-${action}`;

/**
 * Create a permission map with every known matrix cell initialized.
 * @param defaultChecked - Initial checked state for each matrix cell
 * @returns Permission map
 */
const createPermissionMap = (defaultChecked = false): Record<string, boolean> => {
  const next: Record<string, boolean> = {};
  for (const row of allPermissionRows) {
    for (const action of Object.keys(row.permissions)) {
      next[permissionCellKey(row.key, action)] = defaultChecked;
    }
  }
  return next;
};

/**
 * Check whether a matrix row supports a given action.
 * @param row - Matrix row
 * @param action - Permission action
 * @returns True when the row has a concrete permission for the action
 */
const hasPermissionAction = <Action extends string>(row: PermissionMatrixRow<Action>, action: Action): boolean => {
  return Boolean(row.permissions[action]?.length);
};

/**
 * Check whether a saved permission pattern is represented by the matrix.
 * @param pattern - Saved permission pattern
 * @returns True when the pattern maps to at least one matrix cell
 */
const isMatrixRepresentedPermission = (pattern: string): boolean => {
  return matrixPermissionValues.some((permission) => matchesPermissionPattern(pattern, permission));
};

/**
 * Collect selected matrix permissions and include read permissions implied by mutating actions.
 * @returns Permission list from selected matrix cells
 */
const collectSelectedMatrixPermissions = (): string[] => {
  const selected: string[] = [];
  for (const row of allPermissionRows) {
    let hasNonReadAction = false;
    for (const [action, permissions] of Object.entries(row.permissions)) {
      if (!permissions?.length || !formState.permissionMap[permissionCellKey(row.key, action)]) continue;
      selected.push(...permissions);
      if (action !== "read") {
        hasNonReadAction = true;
      }
    }

    const readPermissions = row.permissions.read;
    if (hasNonReadAction && readPermissions?.length) {
      selected.push(...readPermissions);
    }
  }

  return selected;
};

const selectedAllow = computed(() => {
  if (formState.allPermissions) {
    return normalizeActivePermissionList(["*", ...formState.preservedPermissions]);
  }
  return normalizeActivePermissionList([...collectSelectedMatrixPermissions(), ...formState.preservedPermissions]);
});

/**
 * Apply a saved permission list to matrix form state.
 * @param allow - Permission list
 */
const applyPermissionsToForm = (allow: string[]): void => {
  const normalized = normalizeActivePermissionList(allow);
  const nextPermissionMap = createPermissionMap();
  const grantsAll = normalized.includes("*");

  for (const row of allPermissionRows) {
    for (const [action, permissions] of Object.entries(row.permissions)) {
      if (!permissions?.length) continue;
      nextPermissionMap[permissionCellKey(row.key, action)] =
        grantsAll || permissions.some((permission) => normalized.some((pattern) => matchesPermissionPattern(pattern, permission)));
    }
  }

  formState.allPermissions = grantsAll;
  formState.permissionMap = nextPermissionMap;
  formState.preservedPermissions = normalized.filter((permission) => permission !== "*" && !isMatrixRepresentedPermission(permission));
};

/**
 * Remove a preserved permission from the list.
 * @param value - Permission value
 */
const removePreservedPermission = (value: string): void => {
  formState.preservedPermissions = formState.preservedPermissions.filter((permission) => permission !== value);
};

const resetForm = () => {
  formState.name = "";
  formState.description = "";
  formState.allPermissions = false;
  formState.permissionMap = createPermissionMap();
  formState.preservedPermissions = [];
  editingRoleId.value = null;
};

const openCreateDialog = () => {
  resetForm();
  formState.permissionMap = createPermissionMap(true);
  dialogVisible.value = true;
};

const openEditDialog = (role: RoleItem) => {
  editingRoleId.value = role.id;
  formState.name = role.name;
  formState.description = role.description ?? "";
  applyPermissionsToForm(role.permissions.allow);
  dialogVisible.value = true;
};

const closeDialog = () => {
  dialogVisible.value = false;
  dialogSubmitting.value = false;
};

const showErrorToast = (summaryKey: string, detailKey: string) => {
  toast.add({
    severity: "error",
    summary: t(summaryKey),
    detail: t(detailKey),
    life: 4000,
  });
};

const fetchRoles = async () => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/roles");
    if (!res.ok) {
      throw new Error(`Failed to load roles: ${res.status}`);
    }
    const data = (await res.json()) as { items?: RoleItem[] };
    roles.value = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    console.error("Failed to fetch roles", error);
    errorMessage.value = t("settings.roles.error_fetch");
    showErrorToast("settings.roles.title", "settings.roles.error_fetch");
  } finally {
    loading.value = false;
  }
};

const upsertRoleLocal = (role: RoleItem) => {
  const index = roles.value.findIndex((item) => item.id === role.id);
  if (index >= 0) {
    roles.value.splice(index, 1, role);
  } else {
    roles.value = [role, ...roles.value];
  }
};

const removeRoleLocal = (roleId: string) => {
  roles.value = roles.value.filter((role) => role.id !== roleId);
};

const saveRole = async () => {
  dialogSubmitting.value = true;
  try {
    const payload = {
      name: formState.name.trim(),
      description: formState.description.trim() || null,
      permissions: {
        allow: selectedAllow.value,
      },
    };

    const requestInit: RequestInit = {
      method: editingRoleId.value ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };

    const url = editingRoleId.value ? `/api/admin/roles/${encodeResourceId(editingRoleId.value)}` : "/api/admin/roles";

    const res = await authorizedFetch(authStore, url, requestInit);
    if (!res.ok) {
      const status = res.status;
      if (status === 409) {
        showErrorToast("settings.roles.title", "settings.roles.error_conflict");
        return;
      }
      if (status === 404) {
        showErrorToast("settings.roles.title", "settings.roles.error_not_found");
        return;
      }
      if (status === 400) {
        showErrorToast("settings.roles.title", "settings.roles.error_validation");
        return;
      }
      throw new Error(`Failed to save role: ${status}`);
    }

    const data = (await res.json()) as { role?: RoleItem };
    if (data.role) {
      upsertRoleLocal(data.role);
    }
    toast.add({
      severity: "success",
      summary: t("settings.roles.title"),
      detail: t(editingRoleId.value ? "settings.roles.toast_update_success" : "settings.roles.toast_create_success"),
      life: 3000,
    });
    closeDialog();
  } catch (error) {
    console.error("Failed to save role", error);
    showErrorToast("settings.roles.title", "settings.roles.error_save");
  } finally {
    dialogSubmitting.value = false;
  }
};

const deleteRole = async (role: RoleItem) => {
  if (role.isSystem) return;
  const confirmMessage = t("settings.roles.confirm_delete", { name: role.name });
  if (!window.confirm(confirmMessage)) {
    return;
  }
  deleteInProgress.value = { ...deleteInProgress.value, [role.id]: true };
  try {
    const res = await authorizedFetch(authStore, `/api/admin/roles/${encodeResourceId(role.id)}`, {
      method: "DELETE",
    });
    if (res.status === 400) {
      showErrorToast("settings.roles.title", "settings.roles.error_system_role");
      return;
    }
    if (res.status === 404) {
      showErrorToast("settings.roles.title", "settings.roles.error_not_found");
      return;
    }
    if (!res.ok) {
      throw new Error(`Failed to delete role: ${res.status}`);
    }
    removeRoleLocal(role.id);
    toast.add({
      severity: "success",
      summary: t("settings.roles.title"),
      detail: t("settings.roles.toast_delete_success"),
      life: 3000,
    });
  } catch (error) {
    console.error("Failed to delete role", error);
    showErrorToast("settings.roles.title", "settings.roles.error_delete");
  } finally {
    deleteInProgress.value = { ...deleteInProgress.value, [role.id]: false };
  }
};

const formatDate = (value: string) => {
  return formatJapaneseDateTime(value);
};

/**
 * Resolve a localized action label.
 * @param action - Permission action key
 * @returns Localized action label
 */
const formatActionLabel = (action: string): string => t(`settings.roles.permission_action_${action}`);

/**
 * Resolve the accessible label for a matrix checkbox.
 * @param row - Permission matrix row
 * @param action - Permission action key
 * @returns Localized checkbox label
 */
const formatPermissionCellLabel = (row: PermissionMatrixRow<string>, action: string): string => `${t(row.labelKey)} ${formatActionLabel(action)}`;

/**
 * Resolve selected actions for a matrix row from saved permissions.
 * @param row - Permission matrix row
 * @param actions - Ordered action keys
 * @param allow - Saved permission list
 * @returns Localized selected action labels
 */
const resolveSelectedActions = <Action extends string>(row: PermissionMatrixRow<Action>, actions: readonly Action[], allow: string[]): string[] => {
  const grantsAll = allow.includes("*");
  return actions
    .filter((action) => {
      const permissions = row.permissions[action] ?? [];
      return permissions.length > 0 && (grantsAll || permissions.some((permission) => allow.some((pattern) => matchesPermissionPattern(pattern, permission))));
    })
    .map((action) => formatActionLabel(action));
};

/**
 * Build localized permission summary groups for role cards.
 * @param permissions - Permission rules
 * @returns Permission summary groups
 */
const resolvePermissionSummaryGroups = (permissions: RolePermissions): PermissionSummaryGroup[] => {
  const normalized = normalizeActivePermissionList(permissions.allow);
  if (normalized.length === 0) {
    return [{ label: t("settings.roles.permissions_empty"), actions: [] }];
  }
  if (normalized.includes("*")) {
    return [{ label: t("settings.roles.permission_all"), actions: [] }];
  }

  const groups: PermissionSummaryGroup[] = [];
  for (const row of entryPermissionRows) {
    const actions = resolveSelectedActions(row, entryActions, normalized);
    if (actions.length) {
      groups.push({ label: t(row.labelKey), actions });
    }
  }
  for (const row of adminPermissionRows) {
    const actions = resolveSelectedActions(row, adminActions, normalized);
    if (actions.length) {
      groups.push({ label: t(row.labelKey), actions });
    }
  }

  const preservedCount = normalized.filter((permission) => !isMatrixRepresentedPermission(permission)).length;
  if (preservedCount > 0) {
    groups.push({
      label: t("settings.roles.permission_other"),
      actions: [t("settings.roles.permission_other_count", { count: preservedCount })],
    });
  }

  return groups.length ? groups : [{ label: t("settings.roles.permissions_empty"), actions: [] }];
};

/**
 * Check whether a role grants every permission.
 * @param permissions - Permission rules
 * @returns True when the wildcard permission is active
 */
const grantsAllPermissions = (permissions: RolePermissions): boolean => normalizeActivePermissionList(permissions.allow).includes("*");

onMounted(() => {
  fetchRoles();
});
</script>

<template>
  <div class="roles-page">
    <PageSectionHeader :title="t('settings.roles.title')" :description="t('settings.roles.description')" :breadcrumb-model="breadcrumbModel">
      <template #actions>
        <Button severity="primary" icon="lucide:plus" :label="t('settings.roles.new')" @click="openCreateDialog" />
      </template>
    </PageSectionHeader>

    <div v-if="loading" class="loading-state">
      <p>{{ t("settings.roles.loading") }}</p>
    </div>

    <div v-else-if="errorMessage" class="error-state">
      <p>{{ errorMessage }}</p>
      <Button text severity="secondary" icon="lucide:refresh-cw" :label="t('settings.roles.retry')" @click="fetchRoles" />
    </div>

    <div v-else-if="roles.length === 0" class="empty-state">
      <p>{{ t("settings.roles.empty") }}</p>
    </div>

    <div v-else class="roles-grid">
      <Card v-for="role in roles" :key="role.id" class="role-card">
        <template #content>
          <div class="role-header">
            <div class="role-info">
              <div class="title-row">
                <h3 class="role-name">{{ role.name }}</h3>
                <Tag v-if="role.isSystem" severity="secondary" size="small" :value="t('settings.roles.system_badge')" />
              </div>
              <p class="role-description">{{ role.description || t("settings.roles.no_description") }}</p>
              <div class="permissions">
                <span class="permissions-label">{{ t("settings.roles.permissions") }}</span>
                <div class="permissions-value">
                  <span v-if="grantsAllPermissions(role.permissions)" class="permission-summary-group">
                    <span class="permission-summary-group__label">{{ t("settings.roles.permission_all") }}</span>
                  </span>
                  <div v-else class="permission-summary-table-wrap">
                    <table class="permission-summary-table">
                      <caption class="visually-hidden">
                        {{
                          t("settings.roles.permissions")
                        }}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{{ t("settings.roles.permission_table_target") }}</th>
                          <th scope="col">{{ t("settings.roles.permissions_allow") }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="group in resolvePermissionSummaryGroups(role.permissions)" :key="`${role.id}-${group.label}`">
                          <template v-if="group.actions.length">
                            <th scope="row">{{ group.label }}</th>
                            <td>{{ group.actions.join(", ") }}</td>
                          </template>
                          <td v-else colspan="2" class="permission-summary-table__empty">{{ group.label }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div class="role-actions">
              <Button
                text
                size="small"
                icon="lucide:pencil"
                :label="t('common.edit')"
                @click="openEditDialog(role)"
                :disabled="dialogSubmitting && editingRoleId === role.id"
              />
              <Button
                v-if="!role.isSystem"
                text
                severity="danger"
                size="small"
                icon="lucide:trash-2"
                :label="t('common.delete')"
                :disabled="deleteInProgress[role.id] === true"
                @click="deleteRole(role)"
              />
            </div>
          </div>

          <div class="role-meta">
            <span>{{ t("settings.roles.created_at") }} {{ formatDate(role.createdAt) }}</span>
            <span>{{ t("settings.roles.updated_at") }} {{ formatDate(role.updatedAt) }}</span>
          </div>
        </template>
      </Card>
    </div>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :draggable="false"
      :header="editingRoleId ? t('settings.roles.dialog_edit_title') : t('settings.roles.dialog_create_title')"
      :style="{ width: '64rem' }"
      :breakpoints="{ '960px': '90vw', '640px': '95vw' }"
      @hide="resetForm"
    >
      <div class="roles-dialog-form">
        <div class="roles-dialog-field">
          <label class="roles-dialog-label" for="role-name">{{ t("common.name") }}</label>
          <div class="roles-dialog-field__control">
            <InputText
              id="role-name"
              v-model="formState.name"
              class="roles-dialog-control"
              :placeholder="t('settings.roles.form_name_placeholder')"
              autocomplete="off"
            />
          </div>
        </div>

        <div class="roles-dialog-field">
          <label class="roles-dialog-label" for="role-description">{{ t("common.description") }}</label>
          <div class="roles-dialog-field__control">
            <Textarea
              id="role-description"
              v-model="formState.description"
              class="roles-dialog-control"
              :placeholder="t('settings.roles.form_description_placeholder')"
              rows="3"
              :autoResize="true"
            />
          </div>
        </div>

        <div class="roles-dialog-field roles-dialog-field--permissions">
          <label class="roles-dialog-label">{{ t("settings.roles.form_permissions_allow") }}</label>
          <div class="roles-dialog-field__control">
            <div class="permissions-panel">
              <div class="permissions-master" data-test="permission-all">
                <Checkbox v-model="formState.allPermissions" input-id="permission-all" :binary="true" />
                <label class="permissions-master__content" for="permission-all">
                  <span class="permissions-master__label">{{ t("settings.roles.permission_all") }}</span>
                  <span class="permissions-master__description">{{ t("settings.roles.permission_all_description") }}</span>
                </label>
              </div>

              <div class="permissions-section">
                <div class="permissions-section__header">
                  <h4>{{ t("settings.roles.permission_section_entries") }}</h4>
                  <p>{{ t("settings.roles.permission_section_entries_description") }}</p>
                </div>
                <div class="permissions-table-wrap">
                  <table class="permissions-table">
                    <caption class="visually-hidden">
                      {{
                        t("settings.roles.permission_section_entries")
                      }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{{ t("settings.roles.permission_table_target") }}</th>
                        <th v-for="action in entryActions" :key="action" scope="col">{{ formatActionLabel(action) }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in entryPermissionRows" :key="row.key">
                        <th scope="row">
                          <span class="permission-row-label">{{ t(row.labelKey) }}</span>
                          <span v-if="row.descriptionKey" class="permission-row-description">{{ t(row.descriptionKey) }}</span>
                        </th>
                        <td v-for="action in entryActions" :key="`${row.key}-${action}`">
                          <template v-if="hasPermissionAction(row, action)">
                            <Checkbox
                              v-model="formState.permissionMap[permissionCellKey(row.key, action)]"
                              :input-id="permissionCellInputId(row.key, action)"
                              :binary="true"
                              :disabled="formState.allPermissions"
                              :data-test="permissionCellTestId(row.key, action)"
                            />
                            <label class="visually-hidden" :for="permissionCellInputId(row.key, action)">
                              {{ formatPermissionCellLabel(row, action) }}
                            </label>
                          </template>
                          <template v-else>
                            <span class="permission-cell-unavailable" aria-hidden="true">-</span>
                            <span class="visually-hidden">{{ t("settings.roles.permission_not_available") }}</span>
                          </template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="permissions-section">
                <div class="permissions-section__header">
                  <h4>{{ t("settings.roles.permission_section_admin") }}</h4>
                  <p>{{ t("settings.roles.permission_section_admin_description") }}</p>
                </div>
                <div class="permissions-table-wrap">
                  <table class="permissions-table">
                    <caption class="visually-hidden">
                      {{
                        t("settings.roles.permission_section_admin")
                      }}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{{ t("settings.roles.permission_table_target") }}</th>
                        <th v-for="action in adminActions" :key="action" scope="col">{{ formatActionLabel(action) }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in adminPermissionRows" :key="row.key">
                        <th scope="row">
                          <span class="permission-row-label">{{ t(row.labelKey) }}</span>
                          <span v-if="row.descriptionKey" class="permission-row-description">{{ t(row.descriptionKey) }}</span>
                        </th>
                        <td v-for="action in adminActions" :key="`${row.key}-${action}`">
                          <template v-if="hasPermissionAction(row, action)">
                            <Checkbox
                              v-model="formState.permissionMap[permissionCellKey(row.key, action)]"
                              :input-id="permissionCellInputId(row.key, action)"
                              :binary="true"
                              :disabled="formState.allPermissions"
                              :data-test="permissionCellTestId(row.key, action)"
                            />
                            <label class="visually-hidden" :for="permissionCellInputId(row.key, action)">
                              {{ formatPermissionCellLabel(row, action) }}
                            </label>
                          </template>
                          <template v-else>
                            <span class="permission-cell-unavailable" aria-hidden="true">-</span>
                            <span class="visually-hidden">{{ t("settings.roles.permission_not_available") }}</span>
                          </template>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div v-if="formState.preservedPermissions.length" class="permissions-preserved">
                <div class="permissions-preserved__header">
                  <span class="permissions-preserved__label">{{ t("settings.roles.form_permissions_preserved") }}</span>
                  <span class="permissions-preserved__description">{{ t("settings.roles.form_permissions_preserved_hint") }}</span>
                </div>
                <div class="permissions-preserved__list">
                  <div v-for="permission in formState.preservedPermissions" :key="permission" class="permissions-preserved__item">
                    <Tag severity="secondary" :value="permission" />
                    <Button
                      text
                      icon="lucide:x"
                      :aria-label="t('settings.roles.form_permissions_preserved_remove', { permission })"
                      @click="removePreservedPermission(permission)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <Button text :label="t('common.cancel')" @click="closeDialog" :disabled="dialogSubmitting" />
          <Button
            data-test="role-save"
            severity="primary"
            :label="editingRoleId ? t('common.update') : t('common.create')"
            :loading="dialogSubmitting"
            @click="saveRole"
          />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.roles-page {
  padding: var(--space-24);

  .loading-state,
  .error-state,
  .empty-state {
    text-align: center;
    padding: var(--space-48) 0;

    p {
      color: var(--surface-600);
      margin-bottom: var(--space-16);
    }
  }

  .roles-grid {
    display: grid;
    gap: var(--space-16);

    .role-card {
      transition: border-color 0.2s ease;

      &:hover {
        border-color: var(--card-border-hover);
      }

      .role-header {
        display: flex;
        justify-content: space-between;
        gap: var(--space-16);
        margin-bottom: var(--space-16);

        .role-info {
          flex: 1;
          min-width: 0;

          .title-row {
            display: flex;
            align-items: center;
            gap: var(--space-8);
            margin-bottom: var(--space-4);
          }

          .role-name {
            margin: 0;
            font-size: var(--font-18);
            font-weight: 600;
            line-height: 1.25;
            color: var(--surface-900);
          }

          .role-description {
            color: var(--surface-600);
            font-size: var(--font-14);
            margin: 0 0 var(--space-12);
          }

          .permissions {
            display: flex;
            flex-direction: column;
            gap: var(--space-8);

            .permissions-label {
              font-size: var(--font-12);
              color: var(--surface-500);
              text-transform: uppercase;
              letter-spacing: 0.02em;
            }

            .permissions-value {
              width: 100%;
              min-width: 0;
              font-size: var(--font-13);
              color: var(--surface-700);
            }

            .permission-summary-group {
              display: inline-flex;
              align-items: center;
              gap: var(--space-4);
              max-width: 100%;
              padding: var(--space-4) var(--space-8);
              border: 1px solid var(--card-border);
              border-radius: var(--radius-8);
              background: var(--surface-0);
              line-height: 1.35;

              &__label {
                color: var(--surface-800);
                font-weight: 600;
              }

              &__actions {
                color: var(--surface-600);
                overflow-wrap: anywhere;
              }
            }

            .permission-summary-table-wrap {
              width: 100%;
              overflow-x: auto;
              border: 1px solid var(--card-border);
              border-radius: var(--radius-8);
              background: var(--surface-0);
            }

            .permission-summary-table {
              width: 100%;
              min-width: 28rem;
              border-collapse: collapse;

              th,
              td {
                padding: var(--space-8) var(--space-12);
                border-bottom: 1px solid var(--card-border);
                line-height: 1.4;
                text-align: left;
                vertical-align: top;
              }

              thead th {
                color: var(--surface-600);
                font-size: var(--font-12);
                font-weight: 700;
                white-space: nowrap;
              }

              tbody th {
                width: 12rem;
                color: var(--surface-800);
                font-weight: 600;
                white-space: nowrap;
              }

              tbody tr:nth-child(even) {
                background: var(--surface-50);
              }

              tbody tr:last-child th,
              tbody tr:last-child td {
                border-bottom: 0;
              }

              &__empty {
                color: var(--surface-500);
              }
            }
          }
        }

        .role-actions {
          display: flex;
          flex-direction: column;
          gap: var(--space-8);
        }
      }

      .role-meta {
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
        font-size: var(--font-12);
        color: var(--surface-500);
      }
    }
  }
}

.roles-dialog-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);

  .roles-dialog-field {
    display: grid;
    grid-template-columns: minmax(7.5rem, 0.35fr) 1fr;
    column-gap: var(--space-16);
    row-gap: var(--space-4);
    align-items: flex-start;

    &__control {
      width: 100%;

      :deep(.roles-dialog-control) {
        width: 100%;
      }
    }
  }

  .roles-dialog-field--permissions {
    grid-template-columns: 1fr;

    .roles-dialog-label {
      padding-top: 0;
      text-align: left;
    }
  }

  .roles-dialog-label {
    font-size: var(--font-14);
    color: var(--surface-700);
    font-weight: 500;
    padding-top: var(--space-4);
    text-align: right;
    line-height: 1.4;
  }
}

.permissions-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-16);

  .permissions-master {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    padding: var(--space-12);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-8);
    background: var(--surface-50);

    &__content {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: var(--space-2);
      line-height: 1.35;
    }

    &__label {
      color: var(--surface-800);
      font-size: var(--font-14);
      font-weight: 600;
    }

    &__description {
      color: var(--surface-500);
      font-size: var(--font-12);
    }
  }

  .permissions-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .permissions-section__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);

    h4 {
      margin: 0;
      color: var(--surface-800);
      font-size: var(--font-16);
      font-weight: 600;
      line-height: 1.3;
    }

    p {
      margin: 0;
      color: var(--surface-500);
      font-size: var(--font-12);
      line-height: 1.4;
    }
  }

  .permissions-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-8);
    background: var(--surface-0);
  }

  .permissions-table {
    width: 100%;
    min-width: 36rem;
    border-collapse: collapse;

    th,
    td {
      padding: var(--space-12);
      border-bottom: 1px solid var(--card-border);
      text-align: center;
      vertical-align: middle;
    }

    thead th {
      color: var(--surface-600);
      font-size: var(--font-12);
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
      white-space: nowrap;
    }

    thead th:first-child,
    tbody th {
      text-align: left;
    }

    tbody tr:last-child th,
    tbody tr:last-child td {
      border-bottom: 0;
    }

    tbody tr:nth-child(even) {
      background: var(--surface-50);
    }

    tbody th {
      width: 16rem;
    }
  }

  .permission-row-label,
  .permission-row-description {
    display: block;
  }

  .permission-row-label {
    color: var(--surface-800);
    font-size: var(--font-14);
    font-weight: 600;
    line-height: 1.35;
  }

  .permission-row-description {
    margin-top: var(--space-2);
    color: var(--surface-500);
    font-size: var(--font-12);
    font-weight: 400;
    line-height: 1.35;
  }

  .permission-cell-unavailable {
    color: var(--surface-400);
    font-size: var(--font-14);
  }

  .permissions-preserved {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-12);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-8);
    background: var(--surface-50);

    &__header {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    &__label {
      color: var(--surface-800);
      font-size: var(--font-13);
      font-weight: 600;
      line-height: 1.35;
    }

    &__description {
      color: var(--surface-500);
      font-size: var(--font-12);
      line-height: 1.4;
    }

    &__list {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-8);
    }

    &__item {
      display: inline-flex;
      align-items: center;
      gap: var(--space-4);
    }
  }
}

.visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

@media (max-width: 640px) {
  .roles-dialog-form {
    .roles-dialog-field {
      grid-template-columns: 1fr;

      .roles-dialog-label {
        padding-top: 0;
        text-align: left;
      }
    }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-12);
}
</style>
