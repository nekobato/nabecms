import { computed, inject, reactive, ref, type InjectionKey } from "vue";
import { encodeResourceId } from "@/utils/resourceId";

export type ReferenceTarget = { modelId: string; entryId: string; title?: string; modelName?: string };
export type ReferencePane = ReferenceTarget & { key: string; dirty: boolean; busy: boolean; available: boolean };
export const referenceKey = (target: ReferenceTarget) => `${encodeResourceId(target.modelId)}/${encodeResourceId(target.entryId)}`;
/** This encoded ID is safe as data in a double-quoted CSS attribute selector. */
export const referenceActionsId = (target: ReferenceTarget) => `reference-actions-${referenceKey(target)}`;

/** One form instance per entry; the breadcrumb path never owns or discards drafts. */
export function createReferenceSession(root: ReferenceTarget) {
  const rootKey = referenceKey(root);
  const panes = reactive<ReferencePane[]>([{ ...root, key: rootKey, dirty: false, busy: false, available: true }]);
  const path = ref([rootKey]);
  const currentKey = computed(() => path.value.at(-1) ?? rootKey);
  const current = computed(() => panes.find((pane) => pane.key === currentKey.value)!);
  const dirtyPanes = computed(() => panes.filter((pane) => pane.dirty));
  const busy = computed(() => panes.some((pane) => pane.busy));
  const breadcrumbs = computed(() => path.value.map((key) => panes.find((pane) => pane.key === key)!));
  const isOpen = (target: ReferenceTarget) => panes.some((pane) => pane.key === referenceKey(target));
  const open = (target: ReferenceTarget) => {
    if (busy.value || !target.entryId || !target.modelId) return;
    const key = referenceKey(target);
    if (!isOpen(target)) panes.push({ ...target, key, dirty: false, busy: false, available: true });
    const index = path.value.indexOf(key);
    path.value = index >= 0 ? path.value.slice(0, index + 1) : [...path.value, key];
  };
  const back = () => {
    if (!busy.value && path.value.length > 1) path.value = path.value.slice(0, -1);
  };
  const resetRelated = () => {
    if (busy.value) return;
    path.value = [rootKey];
    panes.splice(1);
  };
  const update = (target: ReferenceTarget, patch: Partial<ReferencePane>) => {
    const pane = panes.find((item) => item.key === referenceKey(target));
    if (pane) Object.assign(pane, patch);
  };
  return { rootKey, panes, path, currentKey, current, dirtyPanes, busy, breadcrumbs, isOpen, open, back, resetRelated, update };
}
export type ReferenceSession = ReturnType<typeof createReferenceSession>;
export const referenceSessionKey: InjectionKey<ReferenceSession> = Symbol("entry-reference-session");
export const useReferenceSession = () => inject(referenceSessionKey, null);
