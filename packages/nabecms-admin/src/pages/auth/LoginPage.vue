<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useI18n } from "vue-i18n";
import { Form, Field, type GenericObject, type SubmissionHandler } from "vee-validate";
import { Password } from "@/components/ui/element-plus";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

const loading = ref(false);
const passwordResetEnabled = ref(false);
onMounted(async () => {
  try {
    const res = await fetch("/api/admin/auth/email-capabilities");
    if (res.ok) passwordResetEnabled.value = (await res.json()).passwordResetEnabled === true;
  } catch {
    /* Keep optional recovery hidden when unavailable. */
  }
});
const checking = ref(false);
const errorMsg = ref("");
const needsInitialization = computed(() => auth.allowSignup === true);
const loginDisabled = computed(() => loading.value || checking.value);

type LoginForm = { email: string; password: string };

function toLoginForm(values: GenericObject): LoginForm {
  if (typeof values.email !== "string" || typeof values.password !== "string") {
    throw new Error("Invalid login form payload");
  }
  return { email: values.email, password: values.password };
}

onMounted(async () => {
  if (auth.allowSignup === null && !auth.initialized) {
    checking.value = true;
    await auth.loadBootstrap();
    checking.value = false;
  }
});

const handleLogin: SubmissionHandler = async (values) => {
  if (checking.value) return;
  if (needsInitialization.value) {
    errorMsg.value = t("auth.login.initialize_required");
    return;
  }
  const payload = toLoginForm(values);
  loading.value = true;
  errorMsg.value = "";
  try {
    await auth.login(payload.email, payload.password);
    router.push("/");
  } catch (error: unknown) {
    console.error("Login failed:", error);
    if (error instanceof Error && error.message === "INITIAL_SETUP_REQUIRED") {
      auth.allowSignup = true;
      auth.initialized = false;
      errorMsg.value = t("auth.login.initialize_required");
      return;
    }
    const code = error instanceof Error ? error.message : "";
    errorMsg.value = code === "SERVER_ERROR" ? t("auth.login.error_server") : t("auth.login.error_invalid");
  } finally {
    loading.value = false;
  }
};

const goToInitialize = () => router.push("/auth/initialize");
</script>

<template>
  <div class="auth-shell">
    <div class="auth-shell__panel auth-shell__panel--sm">
      <Card class="auth-shell__card">
        <template #header>
          <div class="auth-shell__header">
            <h1 class="auth-shell__title">{{ t("auth.login.title") }}</h1>
            <p class="auth-shell__description">{{ t("auth.login.description") }}</p>
          </div>
        </template>

        <template #content>
          <div v-if="checking" class="auth-shell__status auth-shell__status--info">
            <p>{{ t("auth.login.checking") }}</p>
          </div>
          <div v-else-if="needsInitialization" class="auth-shell__status auth-shell__status--info">
            <p>{{ t("auth.login.initialize_required") }}</p>
            <Button severity="primary" class="auth-shell__secondary-action" :label="t('auth.login.open_initialize_button')" @click="goToInitialize" />
          </div>
          <div v-else>
            <Form @submit="handleLogin" class="auth-shell__form">
              <div v-if="errorMsg" class="auth-shell__status auth-shell__status--error">
                <p>{{ errorMsg }}</p>
              </div>
              <div class="auth-shell__fields">
                <div class="auth-shell__field">
                  <label for="email" class="auth-shell__field-label">{{ t("auth.login.email_label") }}</label>
                  <Field name="email" v-slot="{ field }">
                    <InputText
                      id="email"
                      :modelValue="field.value"
                      @update:modelValue="field.onChange"
                      @blur="field.onBlur"
                      type="email"
                      placeholder="your@email.com"
                      fluid
                    />
                  </Field>
                </div>

                <div class="auth-shell__field">
                  <label for="password" class="auth-shell__field-label">{{ t("auth.login.password_label") }}</label>
                  <Field name="password" v-slot="{ field }">
                    <Password
                      id="password"
                      :modelValue="field.value"
                      @update:modelValue="field.onChange"
                      @blur="field.onBlur"
                      placeholder="••••••••"
                      toggleMask
                      :feedback="false"
                      fluid
                    />
                  </Field>
                </div>
              </div>

              <Button
                type="submit"
                :disabled="loginDisabled"
                :loading="loading"
                class="auth-shell__primary-action"
                size="large"
                :label="loading ? t('auth.login.submitting') : t('auth.login.submit')"
              />
            </Form>
            <RouterLink v-if="passwordResetEnabled" to="/auth/forgot-password">{{ t("emailSettings.forgot") }}</RouterLink>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>
