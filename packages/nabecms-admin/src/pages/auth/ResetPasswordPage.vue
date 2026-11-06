<script lang="ts" setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Password } from "@/components/ui/element-plus";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const auth = useAuthStore();

const loading = ref(false);
const errorMsg = ref("");
const success = ref(false);
const newPassword = ref("");
const confirmPassword = ref("");

const token = computed(() => (typeof route.query.token === "string" ? route.query.token.trim() : ""));

/**
 * Resolve API error code into UI text.
 */
const resolveResetError = (code: string): string => {
  switch (code) {
    case "TOKEN_EXPIRED":
      return t("auth.reset_password.error_token_expired");
    case "INVALID_TOKEN":
      return t("auth.reset_password.error_token_invalid");
    case "EMAIL_CONFIGURATION_ERROR":
      return t("auth.reset_password.error_email_configuration");
    default:
      return t("auth.reset_password.error_generic");
  }
};

const goToLogin = () => {
  router.push("/auth/login");
};

const handleSubmit = async () => {
  if (loading.value) return;
  errorMsg.value = "";
  if (!token.value) {
    errorMsg.value = t("auth.reset_password.error_token_missing");
    return;
  }
  if (newPassword.value.length < 8) {
    errorMsg.value = t("auth.reset_password.error_password_length");
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = t("auth.reset_password.error_password_mismatch");
    return;
  }

  loading.value = true;
  try {
    await auth.resetPassword(token.value, newPassword.value);
    success.value = true;
    newPassword.value = "";
    confirmPassword.value = "";
    await router.replace({ path: "/auth/reset-password", query: {} });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    errorMsg.value = resolveResetError(code);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="auth-shell">
    <div class="auth-shell__panel auth-shell__panel--md">
      <Card class="auth-shell__card">
        <template #header>
          <div class="auth-shell__header">
            <h1 class="auth-shell__title">
              {{ t("auth.reset_password.title") }}
            </h1>
            <p class="auth-shell__description">
              {{ t("auth.reset_password.description") }}
            </p>
          </div>
        </template>

        <template #content>
          <div v-if="success" class="auth-shell__status auth-shell__status--info">
            <p>
              {{ t("auth.reset_password.success") }}
            </p>
            <Button severity="primary" class="auth-shell__secondary-action" :label="t('auth.reset_password.go_login')" @click="goToLogin" />
          </div>
          <form v-else class="auth-shell__form" @submit.prevent="handleSubmit">
            <div v-if="errorMsg" class="auth-shell__status auth-shell__status--error">
              <p>{{ errorMsg }}</p>
            </div>

            <div class="auth-shell__field">
              <label for="new-password" class="auth-shell__field-label">
                {{ t("auth.reset_password.new_password_label") }}
              </label>
              <Password
                id="new-password"
                v-model="newPassword"
                autocomplete="new-password"
                required
                toggle-mask
                :feedback="false"
                fluid
                :placeholder="t('auth.reset_password.password_placeholder')"
              />
            </div>

            <div class="auth-shell__field">
              <label for="confirm-password" class="auth-shell__field-label">
                {{ t("auth.reset_password.confirm_password_label") }}
              </label>
              <Password
                id="confirm-password"
                v-model="confirmPassword"
                autocomplete="new-password"
                required
                toggle-mask
                :feedback="false"
                fluid
                :placeholder="t('auth.reset_password.password_placeholder')"
              />
            </div>

            <Button
              :disabled="loading"
              :loading="loading"
              class="auth-shell__primary-action"
              size="large"
              :label="loading ? t('auth.reset_password.submitting') : t('auth.reset_password.submit')"
              type="submit"
            />
          </form>
        </template>
      </Card>
    </div>
  </div>
</template>
