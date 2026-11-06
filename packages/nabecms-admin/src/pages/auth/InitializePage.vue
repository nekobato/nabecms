<script lang="ts" setup>
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";
import { useI18n } from "vue-i18n";
import { Form, Field, defineRule, type GenericObject, type SubmissionHandler } from "vee-validate";
import { required as ruleRequired, email as ruleEmail, min as ruleMin } from "@vee-validate/rules";
import { Password } from "@/components/ui/element-plus";

import Button from "@/components/NabeButton.vue";
import { Card } from "@/components/ui/element-plus";
import { InputText } from "@/components/ui/element-plus";
defineRule("required", ruleRequired);
defineRule("email", ruleEmail);
defineRule("min", ruleMin);

const router = useRouter();
const auth = useAuthStore();
const { t } = useI18n();

const commonLocales = [
  { code: "ja-JP", name: "日本語 (日本)" },
  { code: "en-US", name: "English (United States)" },
  { code: "en-GB", name: "English (United Kingdom)" },
  { code: "de-DE", name: "Deutsch (Deutschland)" },
  { code: "fr-FR", name: "Français (France)" },
  { code: "es-ES", name: "Español (España)" },
  { code: "ko-KR", name: "한국어 (대한민국)" },
  { code: "zh-CN", name: "简体中文 (中国)" },
  { code: "zh-TW", name: "繁體中文 (台灣)" },
  { code: "it-IT", name: "Italiano (Italia)" },
  { code: "pt-BR", name: "Português (Brasil)" },
];

const normalizeLocaleCode = (code: string) => code.trim().replace(/_/gu, "-");

const loading = ref(false);
const checking = ref(false);
const errorMsg = ref("");

const canInitialize = computed(() => auth.allowSignup !== false && !auth.initialized);
const blockedMessage = computed(() => {
  if (auth.initialized || auth.allowSignup === false) {
    return t("auth.signup.already_initialized");
  }
  if (errorMsg.value) return errorMsg.value;
  return "";
});

onMounted(async () => {
  if (auth.allowSignup === null && !auth.initialized) {
    checking.value = true;
    await auth.loadBootstrap();
    checking.value = false;
  }
});

type InitForm = {
  name: string;
  email: string;
  password: string;
  defaultLocale: string;
  bootstrapSecret: string;
};

function toInitForm(values: GenericObject): InitForm {
  if (
    typeof values.name !== "string" ||
    typeof values.email !== "string" ||
    typeof values.password !== "string" ||
    typeof values.defaultLocale !== "string" ||
    typeof values.bootstrapSecret !== "string"
  ) {
    throw new Error("Invalid initialize form payload");
  }
  return {
    name: values.name,
    email: values.email,
    password: values.password,
    defaultLocale: values.defaultLocale,
    bootstrapSecret: values.bootstrapSecret,
  };
}

const handleInitialize: SubmissionHandler = async (values) => {
  if (!canInitialize.value) {
    errorMsg.value = t("auth.signup.already_initialized");
    return;
  }
  const payload = toInitForm(values);
  loading.value = true;
  errorMsg.value = "";
  try {
    await auth.initialize(payload.email, payload.password, payload.name, normalizeLocaleCode(payload.defaultLocale), payload.bootstrapSecret.trim());
    router.push("/auth/login");
  } catch (err: unknown) {
    const code = err instanceof Error ? err.message : "initialize failed";
    const messageKey = (() => {
      switch (code) {
        case "ALREADY_INITIALIZED":
          return "auth.signup.already_initialized";
        case "INVALID_BOOTSTRAP_SECRET":
          return "auth.signup.bootstrap_secret_invalid";
        case "BOOTSTRAP_SECRET_NOT_CONFIGURED":
          return "auth.signup.bootstrap_secret_unavailable";
        case "BAD_REQUEST":
          return "auth.signup.invalid_payload";
        case "INTERNAL_SERVER_ERROR":
          return "auth.signup.server_error";
        default:
          return "auth.signup.initialize_failed";
      }
    })();
    errorMsg.value = t(messageKey);
  } finally {
    loading.value = false;
  }
};

const goToLogin = () => router.push("/auth/login");
</script>

<template>
  <div class="auth-shell">
    <div class="auth-shell__panel auth-shell__panel--sm">
      <Card class="auth-shell__card">
        <template #header>
          <div class="auth-shell__header">
            <h1 class="auth-shell__title">{{ t("auth.signup.title") }}</h1>
            <p class="auth-shell__description">{{ t("auth.signup.description") }}</p>
          </div>
        </template>

        <template #content>
          <div v-if="checking" class="auth-shell__status auth-shell__status--info">
            <p>{{ t("auth.signup.checking") }}</p>
          </div>
          <div v-else-if="!canInitialize" class="auth-shell__status auth-shell__status--info">
            <p>{{ blockedMessage }}</p>
            <Button class="auth-shell__secondary-action" outlined :label="t('auth.signup.go_login_button')" @click="goToLogin" />
          </div>
          <div v-else>
            <Form @submit="handleInitialize" class="auth-shell__form">
              <div v-if="errorMsg" class="auth-shell__status auth-shell__status--error">
                <p>{{ errorMsg }}</p>
              </div>
              <div class="auth-shell__fields">
                <div class="auth-shell__field">
                  <label for="name" class="auth-shell__field-label">{{ t("auth.signup.name_label") }}</label>
                  <Field name="name" rules="required|min:2" :validateOnInput="false" :validateOnChange="false" v-slot="{ field, errors }">
                    <InputText
                      id="name"
                      v-bind="field"
                      type="text"
                      :placeholder="t('auth.signup.name_placeholder')"
                      class="w-full"
                      :invalid="!!errors.length"
                      fluid
                    />
                    <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
                  </Field>
                </div>
                <div class="auth-shell__field">
                  <label for="email" class="auth-shell__field-label">{{ t("auth.signup.email_label") }}</label>
                  <Field name="email" rules="required|email" :validateOnInput="false" :validateOnChange="false" v-slot="{ field, errors }">
                    <InputText
                      id="email"
                      v-bind="field"
                      type="email"
                      :placeholder="t('auth.signup.email_placeholder')"
                      class="w-full"
                      :invalid="!!errors.length"
                      fluid
                    />
                    <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
                  </Field>
                </div>
                <div class="auth-shell__field">
                  <label for="password" class="auth-shell__field-label">{{ t("auth.signup.password_label") }}</label>
                  <Field name="password" rules="required|min:8" :validateOnInput="false" :validateOnChange="false" v-slot="{ field, errors }">
                    <Password
                      id="password"
                      :modelValue="field.value"
                      @update:modelValue="field.onChange"
                      @blur="field.onBlur"
                      :placeholder="t('auth.signup.password_placeholder')"
                      :invalid="!!errors.length"
                      toggleMask
                      :feedback="false"
                      fluid
                    />
                    <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
                  </Field>
                </div>
                <div class="auth-shell__field">
                  <label for="bootstrapSecret" class="auth-shell__field-label">{{ t("auth.signup.bootstrap_secret_label") }}</label>
                  <Field name="bootstrapSecret" rules="required|min:8" :validateOnInput="false" :validateOnChange="false" v-slot="{ field, errors }">
                    <Password
                      id="bootstrapSecret"
                      :modelValue="field.value"
                      @update:modelValue="field.onChange"
                      @blur="field.onBlur"
                      :placeholder="t('auth.signup.bootstrap_secret_placeholder')"
                      :invalid="!!errors.length"
                      toggleMask
                      :feedback="false"
                      fluid
                    />
                    <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
                  </Field>
                </div>
                <div class="auth-shell__field">
                  <label for="defaultLocale" class="auth-shell__field-label">{{ t("auth.signup.default_locale_label") }}</label>
                  <Field name="defaultLocale" rules="required|min:2" :validateOnInput="false" :validateOnChange="false" v-slot="{ field, errors }">
                    <InputText
                      id="defaultLocale"
                      v-bind="field"
                      type="text"
                      :placeholder="t('auth.signup.default_locale_placeholder')"
                      class="w-full"
                      list="init-locale-suggestions"
                      :invalid="!!errors.length"
                      fluid
                    />
                    <small class="form-error" v-if="errors[0]">{{ errors[0] }}</small>
                  </Field>
                  <datalist id="init-locale-suggestions">
                    <option v-for="option in commonLocales" :key="option.code" :value="option.code">
                      {{ `${option.code} - ${option.name}` }}
                    </option>
                  </datalist>
                </div>
              </div>
              <Button
                type="submit"
                :disabled="loading"
                :loading="loading"
                class="auth-shell__primary-action"
                size="large"
                :label="loading ? t('auth.signup.submitting') : t('auth.signup.submit')"
              />
            </Form>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>
