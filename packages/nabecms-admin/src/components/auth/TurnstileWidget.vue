<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";

type TurnstileRenderOptions = {
  sitekey: string;
  theme: "auto";
  language: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": (code?: string) => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    nabecmsTurnstileScriptPromise?: Promise<void>;
  }
}

const TURNSTILE_SCRIPT_ID = "nabecms-turnstile-script";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const { siteKey, language = "auto" } = defineProps<{
  siteKey: string;
  language?: string;
}>();

const emit = defineEmits<{
  token: [token: string];
  expired: [];
  error: [code?: string];
}>();

const container = useTemplateRef<HTMLDivElement>("turnstile-container");
let widgetId: string | null = null;

/**
 * Load the Cloudflare Turnstile script once per page.
 */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (window.nabecmsTurnstileScriptPromise) {
    return window.nabecmsTurnstileScriptPromise;
  }

  window.nabecmsTurnstileScriptPromise = new Promise((resolve, reject) => {
    const rejectAndReset = () => {
      window.nabecmsTurnstileScriptPromise = undefined;
      reject(new Error("Failed to load Turnstile script"));
    };
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", rejectAndReset, { once: true });
      if (window.turnstile) resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", rejectAndReset, { once: true });
    document.head.appendChild(script);
  });
  return window.nabecmsTurnstileScriptPromise;
}

/**
 * Remove the current widget instance.
 */
function removeWidget(): void {
  if (!widgetId || !window.turnstile) return;
  window.turnstile.remove(widgetId);
  widgetId = null;
}

/**
 * Render the widget into the template container.
 */
async function renderWidget(): Promise<void> {
  removeWidget();
  if (!container.value || siteKey.trim().length === 0) return;

  try {
    await loadTurnstileScript();
    if (!window.turnstile || !container.value) {
      emit("error", "script_unavailable");
      return;
    }

    widgetId = window.turnstile.render(container.value, {
      sitekey: siteKey,
      theme: "auto",
      language,
      callback: (token) => emit("token", token),
      "expired-callback": () => emit("expired"),
      "error-callback": (code) => emit("error", code),
    });
  } catch {
    emit("error", "script_load_failed");
  }
}

/**
 * Reset the current widget challenge.
 */
function reset(): void {
  if (!widgetId || !window.turnstile) return;
  window.turnstile.reset(widgetId);
}

watch(
  () => siteKey,
  () => {
    void renderWidget();
  },
);

onMounted(() => {
  void renderWidget();
});

onBeforeUnmount(() => {
  removeWidget();
});

defineExpose({ reset });
</script>

<template>
  <div class="turnstile-widget">
    <div ref="turnstile-container" class="turnstile-widget__container" data-test="turnstile-widget" />
  </div>
</template>

<style scoped lang="scss">
.turnstile-widget {
  min-height: 4.875rem;

  &__container {
    min-height: 4.875rem;
  }
}
</style>
