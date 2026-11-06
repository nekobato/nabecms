<script lang="ts" setup>
import { encodeResourceId } from "@/utils/resourceId";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import googleLogoUrl from "@/assets/icons/google-logo.svg?url";
import { ICONS } from "@/utils/icons";

import Button from "@/components/NabeButton.vue";
import { Divider } from "@/components/ui/element-plus";
type SsoFlow = "login" | "initialize" | "invite";

type ProviderItem = {
  id: string;
  enabled: boolean;
  flows: string[];
};

type ProvidersResponse = {
  ssoEnabled?: boolean;
  providers?: ProviderItem[];
};

const props = withDefaults(
  defineProps<{
    flow: SsoFlow;
    redirectSuccess: string;
    redirectError: string;
    inviteToken?: string | null;
    defaultLocale?: string | null;
    turnstileToken?: string | null;
    turnstileRequired?: boolean;
    disabled?: boolean;
    visible?: boolean;
  }>(),
  {
    inviteToken: null,
    defaultLocale: null,
    turnstileToken: null,
    turnstileRequired: false,
    disabled: false,
    visible: true,
  },
);

const emit = defineEmits<{
  (event: "error", code: string): void;
}>();

const { t } = useI18n();
const loading = ref(false);
const startingProviderId = ref<string | null>(null);
const ssoEnabled = ref(false);
const providers = ref<ProviderItem[]>([]);

const parseErrorCode = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload: unknown = await response.json();
    const code =
      payload && typeof payload === "object" && "error" in payload && typeof (payload as { error?: { code?: unknown } }).error?.code === "string"
        ? (payload as { error?: { code?: string } }).error?.code
        : undefined;
    return code ?? fallback;
  } catch {
    return fallback;
  }
};

const providerLabel = (providerId: string): string => {
  const key = `auth.social.provider_${providerId}`;
  const translated = t(key);
  return translated === key ? providerId : translated;
};

const isGoogleProvider = (providerId: string): boolean => providerId === "google";

const availableProviders = computed(() => {
  if (!props.visible || !ssoEnabled.value) return [];
  return providers.value.filter((provider) => provider.enabled && provider.flows.includes(props.flow));
});

const shouldShow = computed(() => props.visible && (loading.value || availableProviders.value.length > 0));

const loadProviders = async () => {
  if (!props.visible) return;

  loading.value = true;
  try {
    const response = await fetch("/api/admin/auth/providers", {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      emit("error", await parseErrorCode(response, "SSO_CONFIGURATION_ERROR"));
      ssoEnabled.value = false;
      providers.value = [];
      return;
    }

    const payload = (await response.json()) as ProvidersResponse;
    ssoEnabled.value = Boolean(payload.ssoEnabled);
    providers.value = Array.isArray(payload.providers) ? payload.providers : [];
  } catch {
    emit("error", "SSO_CONFIGURATION_ERROR");
    ssoEnabled.value = false;
    providers.value = [];
  } finally {
    loading.value = false;
  }
};

const startProvider = async (providerId: string) => {
  if (props.disabled || startingProviderId.value) return;
  if (props.turnstileRequired && !props.turnstileToken) {
    emit("error", "TURNSTILE_REQUIRED");
    return;
  }

  startingProviderId.value = providerId;
  try {
    const body: Record<string, unknown> = {
      flow: props.flow,
      redirectSuccess: props.redirectSuccess,
      redirectError: props.redirectError,
    };
    if (props.flow === "invite" && props.inviteToken) {
      body.inviteToken = props.inviteToken;
    }
    if (props.flow === "initialize" && props.defaultLocale) {
      body.defaultLocale = props.defaultLocale;
    }
    if (props.flow === "login" && props.turnstileToken) {
      body.turnstileToken = props.turnstileToken;
    }

    const response = await fetch(`/api/admin/auth/sso/${encodeResourceId(providerId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      emit("error", await parseErrorCode(response, "OAUTH_CALLBACK_FAILED"));
      return;
    }

    const payload: unknown = await response.json().catch(() => null);
    const url =
      payload && typeof payload === "object" && "url" in payload && typeof (payload as { url?: unknown }).url === "string"
        ? (payload as { url: string }).url
        : null;

    if (!url) {
      emit("error", "OAUTH_CALLBACK_FAILED");
      return;
    }

    window.location.assign(url);
  } catch {
    emit("error", "OAUTH_CALLBACK_FAILED");
  } finally {
    startingProviderId.value = null;
  }
};

onMounted(loadProviders);
</script>

<template>
  <div v-if="shouldShow" class="social-auth">
    <Divider align="center">
      <span class="social-auth__divider-label">
        {{ t("auth.social.or_continue_with") }}
      </span>
    </Divider>
    <p v-if="loading" class="social-auth__loading">
      {{ t("auth.social.loading") }}
    </p>
    <div v-else class="social-auth__buttons">
      <template v-for="provider in availableProviders" :key="provider.id">
        <Button
          v-if="isGoogleProvider(provider.id)"
          type="button"
          outlined
          class="social-auth__button"
          :disabled="disabled || Boolean(startingProviderId)"
          :loading="startingProviderId === provider.id"
          @click="startProvider(provider.id)"
        >
          <span class="social-auth__button-content">
            <img class="social-auth__provider-logo" :src="googleLogoUrl" alt="" aria-hidden="true" />
            <span>{{ providerLabel(provider.id) }}</span>
          </span>
        </Button>
        <Button
          v-else
          type="button"
          outlined
          class="social-auth__button"
          :icon="ICONS.login"
          :label="providerLabel(provider.id)"
          :disabled="disabled || Boolean(startingProviderId)"
          :loading="startingProviderId === provider.id"
          @click="startProvider(provider.id)"
        />
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.social-auth {
  margin-top: var(--space-20, 1.25rem);

  &__divider-label {
    color: var(--app-text-muted);
    font-size: var(--font-12);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  &__loading {
    margin: 0;
    text-align: center;
    color: var(--app-text-muted);
    font-size: var(--font-13);
  }

  &__buttons {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-10, 0.625rem);
  }

  &__button {
    width: 100%;
    justify-content: center;
  }

  &__button-content {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
  }

  &__provider-logo {
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
  }
}
</style>
