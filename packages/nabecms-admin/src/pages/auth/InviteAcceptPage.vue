<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Password } from "@/components/ui/element-plus";
import { useToast } from "@/services/feedback";
import { useAuthStore } from "@/stores/auth";
import { formatJapaneseDateTime } from "@/utils/dateTime";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const toast = useToast();
const auth = useAuthStore();

const token = ref<string | null>(null);
const email = ref("");
const expiresAt = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const errorCode = ref<string | null>(null);
const name = ref("");
const password = ref("");
const passwordConfirm = ref("");
const submitting = ref(false);

const expiresLabel = computed(() => (expiresAt.value ? formatJapaneseDateTime(expiresAt.value) : ""));
const isTerminalInviteError = computed(() => ["INVITE_NOT_FOUND", "INVITE_EXPIRED", "INVITE_CONSUMED", "INVITE_REVOKED"].includes(errorCode.value ?? ""));

const validateToken = async () => {
  if (!token.value) {
    error.value = t("auth.invite.error_token_missing");
    errorCode.value = "INVITE_NOT_FOUND";
    loading.value = false;
    return;
  }
  try {
    const res = await fetch("/api/admin/auth/accept-invite/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.value }),
    });
    if (!res.ok) {
      if (res.status === 410) {
        errorCode.value = "INVITE_EXPIRED";
        error.value = t("auth.sso_errors.INVITE_EXPIRED");
      } else {
        errorCode.value = "INVITE_NOT_FOUND";
        error.value = t("auth.sso_errors.INVITE_NOT_FOUND");
      }
      loading.value = false;
      return;
    }
    const data = await res.json();
    email.value = data.email;
    expiresAt.value = data.expiresAt;
    error.value = null;
    errorCode.value = null;
  } catch (err) {
    console.error("Failed to validate token", err);
    error.value = t("auth.invite.error_invalid");
    errorCode.value = "INTERNAL_SERVER_ERROR";
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  const tokenParam = route.query.token;
  token.value = typeof tokenParam === "string" ? tokenParam : null;
  await validateToken();
});

const submit = async () => {
  if (!token.value) {
    error.value = t("auth.invite.error_token_missing");
    errorCode.value = "INVITE_NOT_FOUND";
    return;
  }
  if (password.value !== passwordConfirm.value) {
    error.value = t("auth.invite.error_password_mismatch");
    errorCode.value = "PASSWORD_MISMATCH";
    return;
  }
  submitting.value = true;
  error.value = null;
  errorCode.value = null;
  try {
    const res = await fetch("/api/admin/auth/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        token: token.value,
        name: name.value.trim(),
        password: password.value,
      }),
    });
    if (!res.ok) {
      if (res.status === 410) {
        errorCode.value = "INVITE_EXPIRED";
        error.value = t("auth.sso_errors.INVITE_EXPIRED");
        return;
      }
      if (res.status === 404) {
        errorCode.value = "INVITE_NOT_FOUND";
        error.value = t("auth.sso_errors.INVITE_NOT_FOUND");
        return;
      }
      throw new Error(`Failed ${res.status}`);
    }
    const data = await res.json();
    auth.setSession(data.accessToken, data.user ?? null);
    toast.add({
      severity: "success",
      summary: t("auth.invite.title"),
      detail: t("auth.invite.toast_success"),
      life: 3000,
    });
    router.push("/");
  } catch (err) {
    console.error("Failed to accept invite", err);
    error.value = t("auth.invite.error_invalid");
    errorCode.value = "INTERNAL_SERVER_ERROR";
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <div class="auth-shell">
    <div class="auth-shell__panel auth-shell__panel--lg">
      <Card class="auth-shell__card">
        <template #header>
          <div class="auth-shell__header">
            <h1 class="auth-shell__title">{{ t("auth.invite.title") }}</h1>
            <p class="auth-shell__description">{{ t("auth.invite.description") }}</p>
          </div>
        </template>
        <template #content>
          <div v-if="loading" class="auth-shell__status auth-shell__status--info">
            <p>{{ t("common.loading") }}</p>
          </div>
          <div v-else-if="error && isTerminalInviteError" class="auth-shell__status auth-shell__status--error">
            <p>{{ error }}</p>
          </div>
          <div v-else class="auth-shell__form">
            <div v-if="error" class="auth-shell__status auth-shell__status--error">
              <p>{{ error }}</p>
            </div>
            <div class="auth-shell__meta">
              <div class="auth-shell__meta-row">
                <span class="auth-shell__meta-label">{{ t("auth.invite.email_label") }}</span>
                <span class="auth-shell__meta-value">{{ email }}</span>
              </div>
              <div class="auth-shell__meta-row" v-if="expiresLabel">
                <span class="auth-shell__meta-label">{{ t("auth.invite.expires_label") }}</span>
                <span class="auth-shell__meta-value">{{ expiresLabel }}</span>
              </div>
            </div>
            <div class="auth-shell__field">
              <label for="invite-name" class="auth-shell__field-label">{{ t("auth.invite.name_label") }}</label>
              <InputText id="invite-name" v-model="name" autocomplete="off" fluid />
            </div>
            <div class="auth-shell__field">
              <label for="invite-password" class="auth-shell__field-label">{{ t("auth.invite.password_label") }}</label>
              <Password id="invite-password" v-model="password" toggleMask :feedback="false" fluid />
            </div>
            <div class="auth-shell__field">
              <label for="invite-password-confirm" class="auth-shell__field-label">{{ t("auth.invite.password_confirm_label") }}</label>
              <Password id="invite-password-confirm" v-model="passwordConfirm" toggleMask :feedback="false" fluid />
            </div>
            <Button
              severity="primary"
              :label="t('auth.invite.submit')"
              :loading="submitting"
              :disabled="submitting"
              class="auth-shell__primary-action"
              @click="submit"
            />
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>
