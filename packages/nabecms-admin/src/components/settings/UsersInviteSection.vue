<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Dialog } from "@/components/ui/element-plus";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { formatJapaneseDateTime } from "@/utils/dateTime";
import { authorizedFetch } from "@/utils/http";
import { isInvitableRole } from "@nekobato/nabecms-core/contracts";
import type { InviteItem, RoleItem, TagSeverity, TokenPreview } from "@/pages/settings/users-shared";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { ElCheckbox } from "element-plus";
import { ElTable } from "element-plus";
import { ElTableColumn } from "element-plus";
import { InputText } from "@/components/ui/element-plus";
import { Select } from "@/components/ui/element-plus";
import { Tag } from "@/components/ui/element-plus";

type Props = {
  roles: RoleItem[];
  showOpenButton?: boolean;
};

const props = withDefaults(defineProps<Props>(), {
  showOpenButton: true,
});

const { t } = useI18n();
const toast = useToast();
const authStore = useAuthStore();

const emailEnabled = ref(false);
const emailResult = ref("");
const sendingId = ref<string | null>(null);
onMounted(async () => {
  try {
    const res = await fetch("/api/admin/auth/email-capabilities");
    if (res.ok) emailEnabled.value = (await res.json()).invitesEnabled === true;
  } catch {
    /* Link copying remains available. */
  }
});
async function sendInvite(id: string) {
  if (sendingId.value) return;
  sendingId.value = id;
  emailResult.value = "";
  try {
    const response = await authorizedFetch(authStore, `/api/admin/auth/invites/${encodeResourceId(id)}/send`, { method: "POST" });
    const body = await response.json();
    emailResult.value = t(
      response.ok
        ? "emailSettings.accepted"
        : body.error?.code === "INVITE_REGENERATE_REQUIRED"
          ? "emailSettings.regenerateRequired"
          : "emailSettings.inviteFailed",
    );
    await fetchInvites();
  } catch {
    emailResult.value = t("emailSettings.inviteFailed");
  } finally {
    sendingId.value = null;
  }
}
const invites = ref<InviteItem[]>([]);
const invitesLoading = ref(false);
const inviteSubmitting = ref(false);
const inviteError = ref<string | null>(null);
const inviteToken = ref<TokenPreview | null>(null);
const inviteDialogVisible = ref(false);
const fetchedRoles = ref<RoleItem[]>([]);

const inviteForm = reactive({
  email: "",
  roleId: null as string | null,
  note: "",
  sendEmail: false,
});

const inviteLink = computed(() => {
  if (!inviteToken.value) return "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const path = `/admin/auth/invite?token=${encodeURIComponent(inviteToken.value.token)}`;
  return `${origin}${path}`;
});
const tokenDialogVisible = computed({
  get: () => Boolean(inviteToken.value),
  set: (value: boolean) => {
    if (!value) inviteToken.value = null;
  },
});
const availableRoles = computed(() => (props.roles.length ? props.roles : fetchedRoles.value));
const roleMap = computed(() => new Map(availableRoles.value.map((role) => [role.id, role])));

const inviteRoleOptions = computed(() =>
  availableRoles.value.filter(isInvitableRole).map((role) => ({
    label: role.name,
    value: role.id,
  })),
);
const canUseInvite = (roleIds: string[]) => roleIds.every((id) => isInvitableRole(roleMap.value.get(id) ?? { id, isSystem: false }));

const formatRelative = (value: string) => {
  return formatJapaneseDateTime(value);
};

const resolveInviteRoles = (roleIds: string[]) => {
  if (!roleIds.length) return t("settings.users.no_roles");
  const names = roleIds.map((roleId) => roleMap.value.get(roleId)?.name ?? roleId);
  return names.join(", ");
};

const inviteStatusTag = (status: string) => {
  const map: Record<string, { severity: TagSeverity; label: string }> = {
    pending: { severity: "secondary", label: t("settings.invites.status_pending") },
    sent: { severity: "info", label: t("settings.invites.status_sent") },
    consumed: { severity: "success", label: t("settings.invites.status_consumed") },
    expired: { severity: "warn", label: t("settings.invites.status_expired") },
    revoked: { severity: "danger", label: t("settings.invites.status_revoked") },
  };
  return map[status] ?? { severity: "secondary", label: status };
};

const fetchInvites = async () => {
  invitesLoading.value = true;
  inviteError.value = null;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/auth/invites");
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    const data = (await res.json()) as { items?: InviteItem[] };
    invites.value = data.items ?? [];
  } catch (error) {
    console.error("Failed to fetch invites", error);
    inviteError.value = t("settings.invites.error_fetch");
  } finally {
    invitesLoading.value = false;
  }
};

const resetInviteForm = () => {
  inviteForm.email = "";
  inviteForm.roleId = null;
  inviteForm.note = "";
  inviteForm.sendEmail = false;
};

/** Load role labels using invitation access when the parent cannot list roles. */
const fetchInviteRoles = async () => {
  if (props.roles.length) return;
  const response = await authorizedFetch(authStore, "/api/admin/auth/invites/role-options");
  if (!response.ok) throw new Error(`Failed: ${response.status}`);
  const body = (await response.json()) as { items: RoleItem[] };
  fetchedRoles.value = body.items;
};

/**
 * Open the invite creation dialog after clearing stale invite errors.
 */
const openInviteDialog = async () => {
  inviteError.value = null;
  inviteDialogVisible.value = true;
  try {
    await fetchInviteRoles();
  } catch {
    inviteError.value = t("settings.users.error_roles");
  }
};

/**
 * Close the invite creation dialog and clear errors shown inside it.
 */
const closeInviteDialog = () => {
  inviteError.value = null;
  inviteDialogVisible.value = false;
};

const createInviteToken = async () => {
  inviteError.value = null;
  if (!inviteForm.email.trim()) {
    inviteError.value = t("settings.invites.error_email_required");
    return;
  }
  if (!inviteForm.roleId || !inviteRoleOptions.value.some((role) => role.value === inviteForm.roleId)) {
    inviteError.value = t("settings.invites.error_role_required");
    return;
  }
  inviteSubmitting.value = true;
  try {
    const res = await authorizedFetch(authStore, "/api/admin/auth/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: inviteForm.email.trim().toLowerCase(),
        roleIds: [inviteForm.roleId],
        note: inviteForm.note || undefined,
        sendEmail: emailEnabled.value && inviteForm.sendEmail,
      }),
    });
    if (res.status === 409) {
      const payload: unknown = await res.json().catch(() => null);
      const code =
        payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: { code?: unknown } }).error?.code === "string"
          ? (payload as { error?: { code?: string } }).error?.code
          : undefined;
      inviteError.value = code === "USER_ALREADY_EXISTS_FOR_INVITE" ? t("settings.invites.error_existing_user") : t("settings.invites.error_conflict");
      return;
    }
    if (res.status === 429) {
      inviteError.value = t("settings.invites.error_rate_limit");
      return;
    }
    if (!res.ok) {
      throw new Error(`Failed ${res.status}`);
    }
    const data = (await res.json()) as { inviteId: string; token: string; expiresAt: string; delivery?: { status: string } };
    emailResult.value = data.delivery ? t(data.delivery.status === "accepted" ? "emailSettings.accepted" : "emailSettings.inviteFailed") : "";
    inviteToken.value = {
      email: inviteForm.email.trim().toLowerCase(),
      token: data.token,
      expiresAt: data.expiresAt,
    };
    resetInviteForm();
    inviteDialogVisible.value = false;
    await fetchInvites();
    toast.add({
      severity: "success",
      summary: t("settings.invites.title"),
      detail: t("settings.invites.toast_created"),
      life: 3000,
    });
  } catch (error) {
    console.error("Failed to create invite", error);
    inviteError.value = t("settings.invites.error_create");
  } finally {
    inviteSubmitting.value = false;
  }
};

const regenerateInviteToken = async (inviteId: string) => {
  inviteError.value = null;
  try {
    const res = await authorizedFetch(authStore, `/api/admin/auth/invites/${encodeResourceId(inviteId)}/regenerate`, {
      method: "POST",
    });
    if (!res.ok) {
      if (res.status === 404) {
        inviteError.value = t("settings.invites.error_not_found");
        return;
      }
      if (res.status === 410) {
        inviteError.value = t("settings.invites.error_used");
        return;
      }
      throw new Error(`Failed ${res.status}`);
    }
    const data = (await res.json()) as { token: string; expiresAt: string };
    const target = invites.value.find((item) => item.id === inviteId);
    inviteToken.value = {
      email: target?.email ?? "",
      token: data.token,
      expiresAt: data.expiresAt,
    };
    await fetchInvites();
    toast.add({
      severity: "success",
      summary: t("settings.invites.title"),
      detail: t("settings.invites.toast_regenerated"),
      life: 3000,
    });
  } catch (error) {
    console.error("Failed to regenerate invite", error);
    inviteError.value = t("settings.invites.error_regenerate");
  }
};

const copyText = async (text?: string, successKey?: string) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.add({
      severity: "success",
      summary: t("common.copy"),
      detail: successKey ? t(successKey) : t("settings.invites.toast_copied"),
      life: 2000,
    });
  } catch (error) {
    console.error("Failed to copy", error);
    toast.add({
      severity: "error",
      summary: t("common.copy"),
      detail: t("settings.invites.error_copy"),
      life: 2000,
    });
  }
};

const copyToken = (token?: string) => copyText(token, "settings.invites.toast_copied");
const copyLink = () => copyText(inviteLink.value, "settings.invites.toast_link_copied");
const closeTokenDialog = () => {
  inviteToken.value = null;
};

defineExpose({ openInviteDialog });

onMounted(async () => {
  await Promise.all([
    fetchInvites(),
    fetchInviteRoles().catch(() => {
      // Keep the list usable with role IDs; opening the dialog retries labels.
    }),
  ]);
});
</script>

<template>
  <div class="users-invite-section">
    <p v-if="emailResult" role="status">{{ emailResult }}</p>
    <div v-if="props.showOpenButton" class="users-invite-section__actions">
      <Button
        type="button"
        data-testid="invite-user-button"
        severity="primary"
        icon="lucide:user-plus"
        :label="t('settings.invites.open_button')"
        @click="openInviteDialog"
      />
    </div>

    <Dialog
      v-model:visible="inviteDialogVisible"
      modal
      appendTo="self"
      class="invite-dialog"
      :draggable="false"
      :header="t('settings.invites.title')"
      :style="{ width: '36rem' }"
      :breakpoints="{ '960px': '90vw', '640px': '95vw' }"
      @hide="closeInviteDialog"
    >
      <div class="invite-form">
        <p class="card-sub">{{ t("settings.invites.description") }}</p>
        <div class="form-field">
          <label for="invite-email">{{ t("settings.invites.email_label") }}</label>
          <InputText id="invite-email" v-model="inviteForm.email" type="email" :placeholder="t('settings.invites.email_placeholder')" autocomplete="off" />
        </div>
        <div class="form-field">
          <label for="invite-role">{{ t("settings.invites.role_label") }}</label>
          <Select
            id="invite-role"
            v-model="inviteForm.roleId"
            :options="inviteRoleOptions"
            optionLabel="label"
            optionValue="value"
            appendTo="self"
            :placeholder="t('settings.invites.role_placeholder')"
          />
        </div>
        <div class="form-field">
          <label for="invite-note">{{ t("settings.invites.note_label") }}</label>
          <InputText id="invite-note" v-model="inviteForm.note" :placeholder="t('settings.invites.note_placeholder')" />
        </div>
        <ElCheckbox v-if="emailEnabled" v-model="inviteForm.sendEmail">{{ t("emailSettings.sendInvite") }}</ElCheckbox>
        <p v-if="inviteError" class="error">{{ inviteError }}</p>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <Button text :label="t('common.cancel')" @click="closeInviteDialog" :disabled="inviteSubmitting" />
          <Button severity="primary" :label="t('settings.invites.generate')" :loading="inviteSubmitting" @click="createInviteToken" />
        </div>
      </template>
    </Dialog>

    <Card class="invites-table" v-if="invites.length > 0 || invitesLoading">
      <template #title>
        <div class="card-title">{{ t("settings.invites.table_title") }}</div>
      </template>
      <template #content>
        <div v-if="invitesLoading" class="loading-state">
          <p>{{ t("settings.invites.loading") }}</p>
        </div>
        <div v-else-if="inviteError">
          <p class="error">{{ inviteError }}</p>
        </div>
        <div v-else>
          <ElTable :data="invites" :stripe="true">
            <ElTableColumn :label="t('settings.invites.table_email')">
              <template #default="{ row: data }">
                <div class="user-cell">
                  <span class="user-email">{{ data.email }}</span>
                  <div class="roles-inline">
                    {{ resolveInviteRoles(data.roleIds) }}
                  </div>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn :label="t('settings.invites.table_status')">
              <template #default="{ row: data }">
                <Tag :severity="inviteStatusTag(data.status).severity" :value="inviteStatusTag(data.status).label" />
              </template>
            </ElTableColumn>
            <ElTableColumn :label="t('settings.invites.table_expires')">
              <template #default="{ row: data }">
                <span>{{ formatRelative(data.expiresAt) }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn :label="t('emailSettings.lastResult')">
              <template #default="{ row: data }">
                <span>{{ data.emailDelivery ? t(`emailSettings.${data.emailDelivery.status}`) : t("emailSettings.neverSent") }}</span>
                <Button
                  v-if="
                    emailEnabled && canUseInvite(data.roleIds) && ['pending', 'sent'].includes(data.status) && new Date(data.expiresAt).getTime() > Date.now()
                  "
                  :disabled="!!sendingId || !data.canResend"
                  :label="t('emailSettings.resend')"
                  @click="sendInvite(data.id)"
                />
                <span v-if="emailEnabled && !data.canResend">{{ t("emailSettings.regenerateRequired") }}</span>
              </template>
            </ElTableColumn>
            <ElTableColumn :label="t('settings.invites.table_actions')">
              <template #default="{ row: data }">
                <div class="action-buttons">
                  <Button
                    text
                    size="small"
                    icon="lucide:refresh-cw"
                    :label="t('settings.invites.regenerate')"
                    :disabled="!canUseInvite(data.roleIds) || (data.status !== 'pending' && data.status !== 'sent')"
                    @click="regenerateInviteToken(data.id)"
                  />
                </div>
              </template>
            </ElTableColumn>
          </ElTable>
        </div>
      </template>
    </Card>

    <Dialog
      v-model:visible="tokenDialogVisible"
      modal
      appendTo="self"
      class="invite-token-dialog"
      :draggable="false"
      :header="t('settings.invites.token_dialog_title')"
      :style="{ width: '36rem' }"
      :breakpoints="{ '960px': '90vw', '640px': '95vw' }"
    >
      <div v-if="inviteToken" class="token-dialog">
        <p v-if="emailResult" role="status">{{ emailResult }}</p>
        <p class="token-email">{{ inviteToken.email }}</p>
        <div class="token-field">
          <InputText readonly :value="inviteToken.token" />
          <Button text icon="lucide:copy" :label="t('common.copy')" @click="copyToken(inviteToken.token)" />
        </div>
        <div class="token-field">
          <InputText readonly :value="inviteLink" />
          <Button text icon="lucide:link" :label="t('settings.invites.copy_link')" @click="copyLink" />
        </div>
        <p class="token-exp">{{ t("settings.invites.token_expires", { date: formatRelative(inviteToken.expiresAt) }) }}</p>
        <p class="token-hint">{{ t("settings.invites.hint_once") }}</p>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <Button severity="primary" :label="t('common.close')" @click="closeTokenDialog" />
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style lang="scss" scoped>
.users-invite-section {
  margin-bottom: var(--space-24);

  &__actions,
  .action-buttons {
    display: flex;
    gap: var(--space-8);
    flex-wrap: wrap;
  }

  &__actions {
    margin-bottom: var(--space-16);
  }

  .invites-table {
    margin-bottom: var(--space-24);
  }

  .loading-state {
    text-align: center;
    padding: var(--space-24) 0;

    p {
      color: var(--surface-600);
    }
  }

  .invite-form {
    .card-sub {
      margin: 0 0 var(--space-16);
      color: var(--surface-600);
      line-height: 1.5;
    }

    .form-field {
      margin-bottom: var(--space-16);

      label {
        display: block;
        font-weight: 600;
        margin-bottom: var(--space-6);
      }
    }

    .error {
      color: var(--red-500);
      font-size: var(--font-12);
      margin-top: var(--space-8);
    }
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-12);
  }

  .user-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .user-email {
    font-size: var(--font-14);
    color: var(--surface-800);
  }

  .roles-inline {
    font-size: var(--font-12);
    color: var(--surface-500);
  }

  .token-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);

    .token-field {
      display: flex;
      gap: var(--space-8);

      @media (max-width: 640px) {
        flex-direction: column;
      }
    }

    .token-email {
      font-weight: 600;
    }

    .token-hint {
      color: var(--surface-600);
      font-size: var(--font-12);
    }
  }
}
</style>
