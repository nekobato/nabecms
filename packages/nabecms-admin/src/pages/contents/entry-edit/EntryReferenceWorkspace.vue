<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElPopover } from "element-plus";
import { Dialog } from "@/components/ui/element-plus";
import Button from "@/components/NabeButton.vue";
import EntryEditor from "../EntryEditor.vue";
import { createReferenceSession, referenceActionsId, referenceSessionKey } from "./referenceSession";

const props = defineProps<{ modelId: string; entryId: string }>();
const { t } = useI18n();
const router = useRouter();
const session = createReferenceSession(props);
provide(referenceSessionKey, session);
const { panes, currentKey, current, breadcrumbs, dirtyPanes, busy } = session;
const related = computed(() => panes.slice(1));
const visible = computed(() => currentKey.value !== session.rootKey);
const middleCrumbs = computed(() => (breadcrumbs.value.length > 4 ? breadcrumbs.value.slice(1, -2) : []));
const tailCrumbs = computed(() => (breadcrumbs.value.length > 4 ? breadcrumbs.value.slice(-2) : breadcrumbs.value.slice(1)));
const dirtyMenu = ref(false);
const rootDirtyMenu = ref(false);
const middleMenu = ref(false);
const breadcrumbElement = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

const confirmDiscard = (titles: string[]) => titles.length === 0 || window.confirm(t("contents.reference_editor.discard", { entries: titles.join("\n") }));
const closeRelated = () => {
  if (busy.value) return;
  const dirty = dirtyPanes.value.filter((pane) => pane.key !== session.rootKey);
  if (confirmDiscard(dirty.map((pane) => pane.title ?? pane.entryId))) session.resetRelated();
};
const navigate = (pane: (typeof panes)[number]) => {
  dirtyMenu.value = false;
  rootDirtyMenu.value = false;
  middleMenu.value = false;
  session.open(pane);
};
watch(currentKey, async () => {
  dirtyMenu.value = false;
  middleMenu.value = false;
  await nextTick();
  if (visible.value) breadcrumbElement.value?.focus();
});
watch(visible, (open) => {
  if (open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
});
const restoreFocus = () => {
  if (!visible.value && returnFocus?.isConnected) returnFocus.focus();
};
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (!dirtyPanes.value.length && !busy.value) return;
  event.preventDefault();
  event.returnValue = "";
};
const removeGuard = router.beforeEach(() => {
  if (busy.value) return false;
  return confirmDiscard(dirtyPanes.value.map((pane) => pane.title ?? pane.entryId));
});
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => {
  removeGuard();
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<template>
  <div class="reference-workspace">
    <div v-if="related.length" class="resume-bar">
      <ElPopover v-model:visible="rootDirtyMenu" trigger="click" :width="320">
        <template #reference>
          <Button severity="secondary" :label="t('contents.reference_editor.unsaved', { count: dirtyPanes.length })" />
        </template>
        <p>{{ t("contents.reference_editor.retained") }}</p>
        <button v-for="pane in panes" :key="pane.key" type="button" class="entry-link" :disabled="busy" @click="navigate(pane)">
          <span>{{ pane.modelName }}</span
          ><strong>{{ pane.title ?? pane.entryId }}</strong>
          <span v-if="pane.dirty">{{ t("contents.reference_editor.dirty") }}</span>
        </button>
      </ElPopover>
      <Button severity="secondary" :disabled="busy" :label="t('contents.reference_editor.close')" @click="closeRelated" />
    </div>
    <EntryEditor :model-id="modelId" :entry-id="entryId" />
    <Dialog
      :visible="visible"
      :header="t('contents.reference_editor.title')"
      class="reference-dialog"
      :style="{ width: '80rem' }"
      :before-close="closeRelated"
      :destroy-on-close="false"
      @hide="restoreFocus"
    >
      <template #header>
        <div class="dialog-heading">
          <strong>{{ t("contents.reference_editor.title") }}</strong>
          <ElPopover v-model:visible="dirtyMenu" trigger="click" :width="320">
            <template #reference>
              <Button severity="secondary" :label="t('contents.reference_editor.unsaved', { count: dirtyPanes.length })" />
            </template>
            <p>{{ t("contents.reference_editor.retained") }}</p>
            <p v-if="!dirtyPanes.length">{{ t("contents.reference_editor.no_changes") }}</p>
            <button v-for="pane in dirtyPanes" :key="pane.key" type="button" class="entry-link" :disabled="busy" @click="navigate(pane)">
              <span>{{ pane.modelName }}</span
              ><strong>{{ pane.title ?? pane.entryId }}</strong>
              <span>{{ t("contents.reference_editor.dirty") }}</span>
            </button>
          </ElPopover>
        </div>
      </template>
      <nav ref="breadcrumbElement" class="breadcrumbs" tabindex="-1" :aria-label="t('contents.reference_editor.path')">
        <button type="button" :disabled="busy" @click="navigate(panes[0]!)">{{ panes[0]?.title ?? entryId }}<span v-if="panes[0]?.dirty"> ●</span></button>
        <ElPopover v-if="middleCrumbs.length" v-model:visible="middleMenu" trigger="click" :width="280">
          <template #reference><button type="button" :aria-label="t('contents.reference_editor.more')">…</button></template>
          <button v-for="pane in middleCrumbs" :key="pane.key" class="entry-link" type="button" :disabled="busy" @click="navigate(pane)">
            {{ pane.title ?? pane.entryId }}<span v-if="pane.dirty"> ●</span>
          </button>
        </ElPopover>
        <template v-for="pane in tailCrumbs" :key="pane.key">
          <span aria-hidden="true">›</span>
          <button type="button" :disabled="busy" :aria-current="pane.key === currentKey ? 'page' : undefined" @click="navigate(pane)">
            {{ pane.title ?? pane.entryId }}<span v-if="pane.dirty"> ●</span>
          </button>
        </template>
      </nav>
      <div v-for="pane in related" v-show="pane.key === currentKey" :key="pane.key" class="editor-pane">
        <EntryEditor :model-id="pane.modelId" :entry-id="pane.entryId" embedded />
      </div>
      <template #footer>
        <div class="dialog-footer">
          <Button severity="secondary" :disabled="busy" :label="t('contents.reference_editor.back')" @click="session.back" />
          <span>{{ t("contents.reference_editor.save_scope") }}</span>
          <div v-for="pane in related" v-show="pane.key === currentKey" :id="referenceActionsId(pane)" :key="pane.key" class="footer-actions"></div>
          <span v-if="!current.available" role="status">{{ t("contents.reference_editor.unavailable") }}</span>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.resume-bar,
.dialog-heading,
.dialog-footer {
  display: flex;
  align-items: center;
  gap: var(--space-12);
  flex-wrap: wrap;
}
.resume-bar {
  justify-content: flex-end;
  margin-bottom: var(--space-16);
}
.dialog-heading {
  justify-content: space-between;
  padding-right: var(--space-32);
}
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-12) 0;
  border-bottom: 1px solid var(--card-border);
}
.breadcrumbs button {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.breadcrumbs button,
.entry-link {
  font: inherit;
  color: var(--primary-color);
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: var(--space-8);
}
.breadcrumbs button[aria-current] {
  font-weight: 600;
  color: var(--surface-900);
}
.breadcrumbs button span {
  color: var(--el-color-warning);
}
.entry-link {
  display: flex;
  flex-direction: column;
  text-align: start;
  gap: var(--space-4);
  width: 100%;
  border-bottom: 1px solid var(--card-border);
  overflow-wrap: anywhere;
}
.entry-link:hover {
  background: var(--surface-100);
}
.breadcrumbs button:focus-visible,
.entry-link:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.editor-pane {
  max-height: 62dvh;
  overflow: auto;
  padding: var(--space-16) var(--space-4);
}
.dialog-footer {
  color: var(--surface-600);
  font-size: var(--font-12);
}
@media (max-width: 640px) {
  .dialog-heading {
    align-items: start;
  }
  .editor-pane {
    max-height: 60dvh;
  }
}
</style>

<style scoped>
.footer-actions {
  margin-inline-start: auto;
}
</style>
