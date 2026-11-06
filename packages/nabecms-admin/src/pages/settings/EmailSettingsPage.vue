<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElCheckbox } from "element-plus";
import type { EmailSettingsResponse } from "@nekobato/nabecms-core/contracts";
import { useAuthStore } from "@/stores/auth";
import { authorizedFetch } from "@/utils/http";
import { Card, InputText } from "@/components/ui/element-plus";
import Button from "@/components/NabeButton.vue";
import PageSectionHeader from "@/components/PageSectionHeader.vue";
const { t } = useI18n();
const auth = useAuthStore();
const allowed = computed(() => auth.user?.roleId.includes("system.super-admin"));
const data = ref<EmailSettingsResponse | null>(null);
const form = reactive({ senderName: "NabeCMS", invitesEnabled: false, passwordResetEnabled: false });
const busy = ref(false);
const error = ref("");
const notice = ref("");
const dirty = computed(() => data.value && JSON.stringify(form) !== JSON.stringify(data.value.item));
/** Refresh saved state without confusing capability detection with actual delivery. */
async function load() {
  const response = await authorizedFetch(auth, "/api/admin/settings/email");
  if (!response.ok) throw new Error("load");
  data.value = (await response.json()) as EmailSettingsResponse;
  Object.assign(form, data.value.item);
}
/** Submit saved policy or a test to the current administrator's own address. */
async function submit(test = false) {
  if (busy.value || !allowed.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const response = await authorizedFetch(auth, `/api/admin/settings/email${test ? "/test" : ""}`, {
      method: test ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      ...(!test ? { body: JSON.stringify(form) } : {}),
    });
    if (!response.ok) {
      if (test) await load();
      throw new Error("save");
    }
    await load();
    notice.value = t(test ? "emailSettings.testAccepted" : "emailSettings.saved");
  } catch {
    error.value = t(test ? "emailSettings.testFailed" : "emailSettings.saveFailed");
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  if (!allowed.value) return;
  busy.value = true;
  try {
    await load();
  } catch {
    error.value = t("emailSettings.loadFailed");
  } finally {
    busy.value = false;
  }
});
</script>
<template>
  <div class="email-settings">
    <PageSectionHeader :title="t('emailSettings.title')" :description="t('emailSettings.description')" />
    <p v-if="!allowed">{{ t("emailSettings.forbidden") }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <Card v-if="data" class="settings-card">
      <template #content>
        <form @submit.prevent="submit(false)" :aria-busy="busy">
          <dl>
            <dt>{{ t("emailSettings.from") }}</dt>
            <dd>{{ data.environment.from || t("emailSettings.unconfigured") }}</dd>
            <dt>{{ t("emailSettings.baseUrl") }}</dt>
            <dd>{{ data.environment.baseUrl || t("emailSettings.unconfigured") }}</dd>
          </dl>
          <p>{{ t("emailSettings.environmentHint") }}</p>
          <p v-if="!data.environment.configured" role="status">{{ t("emailSettings.missing", { names: data.environment.missing.join(", ") }) }}</p>
          <label for="email-sender-name">{{ t("emailSettings.senderName") }}</label>
          <InputText id="email-sender-name" name="senderName" v-model="form.senderName" required maxlength="100" :disabled="busy" />
          <ElCheckbox v-model="form.invitesEnabled" :disabled="busy || (!data.environment.configured && !form.invitesEnabled)">{{
            t("emailSettings.invitesEnabled")
          }}</ElCheckbox>
          <ElCheckbox v-model="form.passwordResetEnabled" :disabled="busy || (!data.environment.configured && !form.passwordResetEnabled)">{{
            t("emailSettings.passwordResetEnabled")
          }}</ElCheckbox>
          <div class="actions">
            <Button type="submit" :label="t('emailSettings.save')" :disabled="busy || !dirty" :loading="busy" />
            <Button type="button" :label="t('emailSettings.test')" :disabled="busy || !!dirty || !data.environment.configured" @click="submit(true)" />
          </div>
          <p>{{ t("emailSettings.testHint") }}</p>
          <p v-if="data.lastDelivery" role="status">
            {{ t("emailSettings.lastResult") }}: {{ t(`emailSettings.${data.lastDelivery.status}`) }} — {{ data.lastDelivery.at }}
          </p>
          <p v-else>{{ t("emailSettings.neverSent") }}</p>
        </form>
      </template>
    </Card>
  </div>
</template>
<style scoped>
.email-settings {
  padding: var(--space-24);
}
.settings-card {
  max-width: 48rem;
}
form {
  display: grid;
  gap: var(--space-16);
}
dl {
  display: grid;
  gap: var(--space-8);
  margin: 0;
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
p {
  margin: 0;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-12);
}
</style>
