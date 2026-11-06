<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, reactive, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "@/services/feedback";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
import UsersInviteSection from "@/components/settings/UsersInviteSection.vue";
import type { RoleItem, UserItem } from "@/pages/settings/users-shared";
import { useAuthStore } from "@/stores/auth";
import { formatJapaneseDateTime, formatJapaneseDateTimeParts } from "@/utils/dateTime";
import { authorizedFetch } from "@/utils/http";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Dialog } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";
import { Listbox } from "@/components/ui/element-plus";
type FormState = {
  name: string;
  email: string;
  roleIds: string[];
};

type FormErrors = {
  name: string | null;
  email: string | null;
  roleIds: string | null;
};

type UsersInviteSectionExpose = {
  openInviteDialog: () => void;
};

const { t } = useI18n();
const router = useRouter();
const toast = useToast();
const authStore = useAuthStore();
const resolveUrl = (path: string) => (typeof router.resolve === "function" ? router.resolve(path).href : path);

const users = ref<UserItem[]>([]);
const roles = ref<RoleItem[]>([]);
const loading = ref(false);
const rolesLoading = ref(false);
const errorMessage = ref<string | null>(null);
const userListForbidden = ref(false);
const passwordResetEnabled = ref(false);
const dialogVisible = ref(false);
const dialogSubmitting = ref(false);
const editingUserId = ref<string | null>(null);
const deleteInProgress = ref<Record<string, boolean>>({});
const usersInviteSection = useTemplateRef<UsersInviteSectionExpose>("usersInviteSection");

const formState = reactive<FormState>({
  name: "",
  email: "",
  roleIds: [],
});

const formErrors = reactive<FormErrors>({
  name: null,
  email: null,
  roleIds: null,
});

const breadcrumbModel = computed(() => [{ label: t("settings.title"), to: "/settings", url: resolveUrl("/settings") }, { label: t("settings.users.title") }]);
const roleMap = computed(() => new Map(roles.value.map((role) => [role.id, role])));
const editingUser = computed(() => users.value.find((user) => user.id === editingUserId.value) ?? null);
const canEditEmail = computed(() => !!editingUserId.value && editingUserId.value === authStore.user?.id);

const resetForm = () => {
  formState.name = "";
  formState.email = "";
  formState.roleIds = [];
  formErrors.name = null;
  formErrors.email = null;
  formErrors.roleIds = null;
  editingUserId.value = null;
};

const openEditDialog = (user: UserItem) => {
  editingUserId.value = user.id;
  formState.name = user.name;
  formState.email = user.email;
  formState.roleIds = [...user.roleIds];
  formErrors.name = null;
  formErrors.email = null;
  formErrors.roleIds = null;
  dialogVisible.value = true;
};

const closeDialog = () => {
  dialogVisible.value = false;
  dialogSubmitting.value = false;
};

const showErrorToast = (detailKey: string) => {
  toast.add({
    severity: "error",
    summary: t("settings.users.title"),
    detail: t(detailKey),
    life: 4000,
  });
};

const fetchRoles = async () => {
  rolesLoading.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/roles");
    if (res.status === 403) {
      roles.value = [];
      return;
    }
    if (!res.ok) {
      throw new Error(`Failed to load roles: ${res.status}`);
    }
    const data = (await res.json()) as { items?: RoleItem[] };
    roles.value = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    console.error("Failed to fetch roles", error);
    showErrorToast("settings.users.error_roles");
  } finally {
    rolesLoading.value = false;
  }
};

const fetchUsers = async () => {
  loading.value = true;
  errorMessage.value = null;
  userListForbidden.value = false;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/users");
    if (res.status === 403) {
      userListForbidden.value = true;
      users.value = [];
      return;
    }
    if (!res.ok) {
      throw new Error(`Failed to load users: ${res.status}`);
    }
    const data = (await res.json()) as { items?: UserItem[] };
    users.value = Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    console.error("Failed to fetch users", error);
    errorMessage.value = t("settings.users.error_fetch");
    showErrorToast("settings.users.error_fetch");
  } finally {
    loading.value = false;
  }
};

const formatDate = (value: string) => formatJapaneseDateTime(value);
const formatDateParts = (value: string) => formatJapaneseDateTimeParts(value);

const resolveRoleNames = (user: UserItem) => {
  if (!user.roleIds.length) return t("settings.users.no_roles");
  const names = user.roleIds.map((roleId) => roleMap.value.get(roleId)?.name ?? roleId);
  return names.join(", ");
};

const validateForm = (): boolean => {
  formErrors.name = null;
  formErrors.email = null;
  formErrors.roleIds = null;

  const name = formState.name.trim();
  const email = formState.email.trim();

  let valid = true;
  if (name.length === 0) {
    formErrors.name = t("settings.users.error_name_required");
    valid = false;
  }
  if (email.length === 0) {
    formErrors.email = t("settings.users.error_email_required");
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    formErrors.email = t("settings.users.error_email_invalid");
    valid = false;
  }
  if (formState.roleIds.length === 0) {
    formErrors.roleIds = t("settings.users.error_role_required");
    valid = false;
  }

  return valid;
};

const saveUser = async () => {
  if (!validateForm()) return;
  if (!editingUserId.value) {
    showErrorToast("settings.users.error_not_found");
    return;
  }

  dialogSubmitting.value = true;
  try {
    const payload = {
      name: formState.name.trim(),
      ...(formState.roleIds.length === editingUser.value?.roleIds.length && formState.roleIds.every((id) => editingUser.value?.roleIds.includes(id))
        ? {}
        : { roleIds: [...formState.roleIds] }),
      ...(canEditEmail.value && formState.email.trim().toLowerCase() !== editingUser.value?.email.toLowerCase()
        ? { email: formState.email.trim().toLowerCase() }
        : {}),
    };

    const res = await authorizedFetch(authStore, `/api/admin/users/${encodeResourceId(editingUserId.value)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      if (res.status === 409) {
        showErrorToast("settings.users.error_conflict");
        return;
      }
      if (res.status === 404) {
        showErrorToast("settings.users.error_not_found");
        return;
      }
      if (res.status === 400) {
        showErrorToast("settings.users.error_validation");
        return;
      }
      throw new Error(`Failed to save user: ${res.status}`);
    }

    const data = (await res.json()) as { user?: UserItem };
    if (data.user) {
      const user = data.user;
      const index = users.value.findIndex((item) => item.id === user.id);
      if (index >= 0) {
        users.value.splice(index, 1, user);
      } else {
        users.value = [user, ...users.value];
      }
    }

    toast.add({
      severity: "success",
      summary: t("settings.users.title"),
      detail: t("settings.users.toast_update_success"),
      life: 3000,
    });
    closeDialog();
  } catch (error) {
    console.error("Failed to save user", error);
    showErrorToast("settings.users.error_save");
  } finally {
    dialogSubmitting.value = false;
  }
};

const deleteUser = async (user: UserItem) => {
  if (user.isSystemUser) {
    showErrorToast("settings.users.error_system_user");
    return;
  }

  const confirmMessage = t("settings.users.confirm_delete", { name: user.name });
  if (!window.confirm(confirmMessage)) return;

  deleteInProgress.value = { ...deleteInProgress.value, [user.id]: true };
  try {
    const res = await authorizedFetch(authStore, `/api/admin/users/${encodeResourceId(user.id)}`, {
      method: "DELETE",
    });
    if (res.status === 400) {
      showErrorToast("settings.users.error_system_user");
      return;
    }
    if (res.status === 404) {
      showErrorToast("settings.users.error_not_found");
      return;
    }
    if (!res.ok) {
      throw new Error(`Failed to delete user: ${res.status}`);
    }
    users.value = users.value.filter((item) => item.id !== user.id);
    toast.add({
      severity: "success",
      summary: t("settings.users.title"),
      detail: t("settings.users.toast_delete_success"),
      life: 3000,
    });
  } catch (error) {
    console.error("Failed to delete user", error);
    showErrorToast("settings.users.error_delete");
  } finally {
    deleteInProgress.value = { ...deleteInProgress.value, [user.id]: false };
  }
};

const roleOptions = computed(() =>
  roles.value.map((role) => ({
    label: role.name,
    value: role.id,
    disabled: editingUser.value?.isSystemUser === true && role.isSystem,
  })),
);

const isSystemUser = (user: UserItem) => user.isSystemUser;

/** Resolve whether the user can be deleted under the server's system-user rule. */
const canDeleteUser = (user: UserItem): boolean => !user.isSystemUser;

/**
 * Open the invite dialog owned by the invite section from the page header action.
 */
const openInviteDialogFromHeader = () => {
  usersInviteSection.value?.openInviteDialog();
};

onMounted(async () => {
  try {
    const response = await fetch("/api/admin/auth/email-capabilities");
    if (response.ok) passwordResetEnabled.value = (await response.json()).passwordResetEnabled === true;
  } catch {
    passwordResetEnabled.value = false;
  }
  await fetchRoles();
  await fetchUsers();
});
</script>

<template>
  <div class="users-page">
    <PageSectionHeader :title="t('settings.users.title')" :description="t('settings.users.description')" :breadcrumb-model="breadcrumbModel">
      <template #actions>
        <Button
          type="button"
          data-testid="invite-user-button"
          severity="primary"
          icon="lucide:user-plus"
          :label="t('settings.invites.open_button')"
          @click="openInviteDialogFromHeader"
        />
      </template>
    </PageSectionHeader>

    <UsersInviteSection ref="usersInviteSection" :roles="roles" :show-open-button="false" />

    <div v-if="loading || rolesLoading" class="loading-state">
      <p>{{ t("settings.users.loading") }}</p>
    </div>

    <p v-else-if="userListForbidden">{{ t("settings.users.list_forbidden") }}</p>
    <div v-else-if="errorMessage" class="error-state">
      <p>{{ errorMessage }}</p>
      <Button text severity="secondary" icon="lucide:refresh-cw" :label="t('settings.users.retry')" @click="fetchUsers" />
    </div>

    <div v-else-if="users.length === 0" class="empty-state">
      <p>{{ t("settings.users.empty") }}</p>
    </div>

    <Card v-else class="users-table">
      <template #content>
        <ElTable :data="users" :stripe="true" style="min-width: 56rem">
          <!-- @vue-generic {UserItem} -->
          <ElTableColumn :label="t('settings.users.table_user')">
            <template #default="{ row: data }">
              <div class="user-cell">
                <div class="user-name-row">
                  <span class="user-name">{{ data.name }}</span>
                  <Tag v-if="isSystemUser(data)" severity="secondary" :value="t('settings.users.system_badge')" />
                </div>
                <span class="user-email">{{ data.email }}</span>
              </div>
            </template>
          </ElTableColumn>

          <!-- @vue-generic {UserItem} -->
          <ElTableColumn :label="t('settings.users.table_roles')">
            <template #default="{ row: data }">
              {{ resolveRoleNames(data) }}
            </template>
          </ElTableColumn>

          <ElTableColumn :label="t('settings.users.table_created')">
            <template #default="{ row: data }">
              <span class="date-cell" :aria-label="formatDate(data.createdAt)">
                <span class="date-cell__date">{{ formatDateParts(data.createdAt).date }}</span>
                <span v-if="formatDateParts(data.createdAt).time" class="date-cell__time">{{ formatDateParts(data.createdAt).time }}</span>
              </span>
            </template>
          </ElTableColumn>

          <ElTableColumn :label="t('settings.users.table_updated')">
            <template #default="{ row: data }">
              <span class="date-cell" :aria-label="formatDate(data.updatedAt)">
                <span class="date-cell__date">{{ formatDateParts(data.updatedAt).date }}</span>
                <span v-if="formatDateParts(data.updatedAt).time" class="date-cell__time">{{ formatDateParts(data.updatedAt).time }}</span>
              </span>
            </template>
          </ElTableColumn>

          <!-- @vue-generic {UserItem} -->
          <ElTableColumn label="">
            <template #default="{ row: data }">
              <div class="action-buttons">
                <Button text size="small" icon="lucide:pencil" :label="t('common.edit')" @click="openEditDialog(data)" />
                <Button
                  v-if="canDeleteUser(data)"
                  text
                  severity="danger"
                  size="small"
                  icon="lucide:trash-2"
                  :label="t('common.delete')"
                  :disabled="deleteInProgress[data.id] === true"
                  @click="deleteUser(data)"
                />
              </div>
            </template>
          </ElTableColumn>
        </ElTable>
      </template>
    </Card>

    <Dialog
      v-model:visible="dialogVisible"
      modal
      :draggable="false"
      :header="t('settings.users.dialog_edit_title')"
      :style="{ width: '36rem' }"
      @hide="resetForm"
    >
      <div class="dialog-body">
        <div class="form-field half">
          <label for="user-name">{{ t("settings.users.form_name_label") }}</label>
          <InputText id="user-name" v-model="formState.name" :placeholder="t('settings.users.form_name_placeholder')" autocomplete="off" class="field-input" />
          <small v-if="formErrors.name" class="error">{{ formErrors.name }}</small>
        </div>

        <div class="form-field half">
          <label for="user-email">{{ t("settings.users.form_email_label") }}</label>
          <InputText
            id="user-email"
            v-model="formState.email"
            type="email"
            :readonly="!canEditEmail"
            :placeholder="t('settings.users.form_email_placeholder')"
            autocomplete="off"
            class="field-input"
          />
          <small v-if="formErrors.email" class="error">{{ formErrors.email }}</small>
          <small v-if="!canEditEmail" class="hint">{{ t("settings.users.email_self_only") }}</small>
        </div>

        <div class="form-field full" data-testid="password-reset-help">
          <small class="hint">{{ t("settings.users.password_reset_hint") }}</small>
          <a v-if="passwordResetEnabled" :href="resolveUrl('/auth/forgot-password')">{{ t("settings.users.password_reset_link") }}</a>
          <small v-else class="hint">{{ t("settings.users.password_reset_unavailable") }}</small>
        </div>

        <div class="form-field full">
          <label>{{ t("settings.users.form_roles_label") }}</label>
          <Listbox
            v-model="formState.roleIds"
            :options="roleOptions"
            optionLabel="label"
            optionValue="value"
            optionDisabled="disabled"
            :disabled="rolesLoading"
            multiple
            checkmark
            class="roles-listbox field-input"
          />
          <small v-if="formErrors.roleIds" class="error">{{ formErrors.roleIds }}</small>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <Button text :label="t('common.cancel')" @click="closeDialog" :disabled="dialogSubmitting" />
          <Button severity="primary" :label="t('common.update')" :loading="dialogSubmitting" @click="saveUser" />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.users-page {
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

  .users-table {
    .user-cell {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);

      .user-name-row {
        display: flex;
        align-items: center;
        gap: var(--space-8);
      }

      .user-name {
        font-size: var(--font-16);
        font-weight: 600;
        color: var(--surface-900);
      }

      .user-email {
        font-size: var(--font-14);
        color: var(--surface-600);
      }
    }

    .date-cell {
      display: inline-flex;
      flex-direction: column;
      gap: var(--space-4);
      white-space: nowrap;
      font-size: var(--font-12);
      color: var(--surface-500);
      line-height: 1.3;

      &__date,
      &__time {
        display: block;
      }
    }

    .action-buttons {
      display: flex;
      gap: var(--space-8);
      flex-wrap: wrap;
    }
  }
}

.dialog-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-16);

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    grid-column: span 2;

    &.half {
      grid-column: span 1;
    }

    &.full {
      grid-column: span 2;
    }

    label {
      font-size: var(--font-14);
      color: var(--surface-700);
      font-weight: 500;
    }

    .hint {
      font-size: var(--font-12);
      color: var(--surface-500);
    }

    .error {
      font-size: var(--font-12);
      color: var(--red-500);
    }
  }

  .roles-listbox {
    max-height: 12rem;
  }
}

.field-input {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-12);
}

@media (max-width: 640px) {
  .dialog-body {
    grid-template-columns: 1fr;

    .form-field {
      grid-column: span 1;
    }
  }
}
</style>
