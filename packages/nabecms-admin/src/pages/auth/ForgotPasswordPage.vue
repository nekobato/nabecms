<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { Card, InputText } from "@/components/ui/element-plus";
import Button from "@/components/NabeButton.vue";
const { t } = useI18n();
const auth = useAuthStore();
const enabled = ref(false);
const checking = ref(true);
const email = ref("");
const busy = ref(false);
const success = ref(false);
const error = ref("");
onMounted(async () => {
  try {
    const response = await fetch("/api/admin/auth/email-capabilities");
    if (response.ok) enabled.value = (await response.json()).passwordResetEnabled === true;
  } catch {
    enabled.value = false;
  } finally {
    checking.value = false;
  }
});
async function submit() {
  if (!enabled.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await auth.requestPasswordReset(email.value.trim());
    success.value = true;
  } catch {
    error.value = t("emailSettings.resetFailed");
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="forgot-password">
    <Card class="panel">
      <template #content>
        <h1>{{ t("emailSettings.forgot") }}</h1>
        <p v-if="error" role="alert">{{ error }}</p>
        <p v-if="success" role="status">{{ t("emailSettings.resetRequested") }}</p>
        <p v-else-if="checking" role="status">{{ t("emailSettings.checking") }}</p>
        <p v-else-if="!enabled">{{ t("emailSettings.resetUnavailable") }}</p>
        <form v-else @submit.prevent="submit">
          <label for="reset-email">{{ t("auth.login.email_label") }}</label>
          <InputText id="reset-email" name="email" type="email" autocomplete="email" required v-model="email" :disabled="busy" />
          <Button type="submit" :label="t('emailSettings.requestReset')" :disabled="busy" :loading="busy" />
        </form>
        <RouterLink to="/auth/login">{{ t("auth.reset_password.go_login") }}</RouterLink>
      </template>
    </Card>
  </div>
</template>
<style scoped>
.forgot-password {
  display: grid;
  min-height: 100dvh;
  place-items: center;
  padding: var(--space-24);
}
.panel {
  width: 100%;
  max-width: 32rem;
}
form {
  display: grid;
  gap: var(--space-16);
  margin-block: var(--space-24);
}
</style>
