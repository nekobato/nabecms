import { encodeResourceId } from "@/utils/resourceId";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "@/services/feedback";
import { authorizedFetch } from "@/utils/http";
import { useAuthStore } from "@/stores/auth";
import type { ModelFieldEditPayload, SubmitPayload } from "@/components/model-field/add-field/types";
import {
  applyLocalFieldOrder,
  applyTitleSelectionToFields,
  resolveTitleFieldId,
  sortFieldsByPosition,
  toModelDependency,
  toModelDetail,
  toModelField,
} from "./model-detail-normalizers";
import type { ModelDependency, ModelDetail, ModelField } from "./model-detail-types";
import { createBeforeUnloadHandler, formatDateTime, installUnsavedChangesRouteGuard } from "./model-detail-view";

export type { ModelDependency, ModelDetail, ModelField } from "./model-detail-types";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Manages the model detail page state, mutations, and navigation guards.
 */
export function useModelDetail() {
  const route = useRoute();
  const router = useRouter();
  const authStore = useAuthStore();
  const toast = useToast();
  const { t } = useI18n();

  const modelId = route.params.modelId as string;

  const model = ref<ModelDetail | null>(null);
  const fields = ref<ModelField[]>([]);
  const loading = ref(true);
  const errorMessage = ref<string | null>(null);
  const titleFieldDraftId = ref<string | null>(null);
  const creatingField = ref(false);
  const savedOrderIds = ref<string[]>([]);
  const applyingOrder = ref(false);
  const editingInline = ref(false);
  const editingDirty = ref(false);
  const editingSubmitting = ref(false);
  const editingValid = ref(true);
  let removeRouteGuard: (() => void) | null = null;

  const showAddFieldDialog = ref(false);
  const showEditFieldDialog = ref(false);
  const editingField = ref<ModelField | null>(null);
  const updatingFieldId = ref<string | null>(null);
  const deletingFieldIds = ref<Record<string, boolean>>({});
  const showDeleteDialog = ref(false);
  const deletingModel = ref(false);
  const dependenciesLoading = ref(false);
  const dependenciesError = ref<string | null>(null);
  const dependencies = ref<ModelDependency[]>([]);

  const formattedCreatedAt = computed(() => formatDateTime(model.value?.createdAt));
  const formattedUpdatedAt = computed(() => formatDateTime(model.value?.updatedAt));
  const modelForm = computed(() => ({
    name: model.value?.name ?? "",
    description: model.value?.description ?? "",
    isPublic: model.value?.isPublic ?? true,
  }));

  const titleFieldDirty = computed(() => {
    if (!model.value) return false;
    const current = model.value.titleFieldId ?? null;
    return titleFieldDraftId.value !== current;
  });

  const applyLocalOrder = (list: ModelField[]) => {
    fields.value = applyLocalFieldOrder(list);
  };

  const applyTitleSelection = (selectedId: string | null, list: ModelField[] = fields.value) => {
    const nextSelection = applyTitleSelectionToFields(list, selectedId);
    fields.value = nextSelection.fields;
    titleFieldDraftId.value = nextSelection.titleFieldId;
  };

  const syncTitleSelection = (list: ModelField[] = fields.value, preferred?: string | null) => {
    const resolved = resolveTitleFieldId(list, preferred ?? titleFieldDraftId.value ?? model.value?.titleFieldId ?? null);
    applyTitleSelection(resolved, list);
  };

  const syncSavedOrder = (list: ModelField[] = fields.value) => {
    savedOrderIds.value = list.map((field) => field.id);
  };

  /** Update the per-field deleting state without mutating nested ref state in place. */
  const setFieldDeleting = (fieldId: string, deleting: boolean) => {
    if (deleting) {
      deletingFieldIds.value = { ...deletingFieldIds.value, [fieldId]: true };
      return;
    }

    const next = { ...deletingFieldIds.value };
    delete next[fieldId];
    deletingFieldIds.value = next;
  };

  const resetFieldOrder = () => {
    if (savedOrderIds.value.length === 0) return;
    const map = new Map(fields.value.map((field) => [field.id, field]));
    const reordered = savedOrderIds.value.map((id) => map.get(id)).filter((field): field is ModelField => Boolean(field));
    if (reordered.length !== savedOrderIds.value.length) return;
    applyLocalOrder(reordered);
  };

  const hasUnsavedOrderChanges = computed(() => {
    const current = fields.value.map((field) => field.id);
    if (current.length !== savedOrderIds.value.length) {
      return current.length > 0 || savedOrderIds.value.length > 0;
    }
    return current.some((id, index) => savedOrderIds.value[index] !== id);
  });

  const hasUnsavedChanges = computed(() => hasUnsavedOrderChanges.value || editingDirty.value || titleFieldDirty.value);
  const handleBeforeUnload = createBeforeUnloadHandler(hasUnsavedChanges);

  const setupRouteLeaveGuard = () => {
    removeRouteGuard = installUnsavedChangesRouteGuard(router, hasUnsavedChanges, t("models.detail.order_leave_confirm"));
  };

  const fetchModel = async () => {
    loading.value = true;
    errorMessage.value = null;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }
      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}`);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed with status ${res.status}`);
      }
      const data = await res.json();
      if (!isRecord(data) || !("item" in data)) {
        throw new Error("Model not found");
      }
      model.value = toModelDetail(data.item);
      titleFieldDraftId.value = model.value.titleFieldId ?? null;
    } catch (error) {
      console.error("Failed to fetch model:", error);
      errorMessage.value = t("models.detail.error_fetch");
      model.value = null;
    } finally {
      loading.value = false;
    }
  };

  const fetchFields = async () => {
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }
      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields`);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const normalized = sortFieldsByPosition(data.map((field) => toModelField(field)));
      syncTitleSelection(normalized, model.value?.titleFieldId ?? titleFieldDraftId.value);
      applyLocalOrder(fields.value);
      syncSavedOrder(fields.value);
    } catch (error) {
      console.error("Failed to fetch model fields:", error);
    }
  };

  const handleRowReorder = (value: ModelField[]) => {
    applyLocalOrder(value);
  };

  const applyFieldOrder = async () => {
    if (!hasUnsavedOrderChanges.value || applyingOrder.value) return;
    applyingOrder.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const payload = {
        orders: fields.value.map((field, index) => ({
          fieldId: field.id,
          position: index,
        })),
      } as const;

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields/order`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(bodyText || `Request failed with status ${res.status}`);
      }

      syncSavedOrder();
      toast.add({
        severity: "success",
        summary: t("models.detail.apply_order"),
        detail: t("models.detail.apply_order_success"),
        life: 4000,
      });
    } catch (error) {
      console.error("Failed to apply field order:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.detail.apply_order_error");
      toast.add({
        severity: "error",
        summary: t("models.detail.apply_order"),
        detail,
        life: 4000,
      });
    } finally {
      applyingOrder.value = false;
    }
  };

  const addField = () => {
    showAddFieldDialog.value = true;
  };

  const setEditingInline = (value: boolean) => {
    editingInline.value = value;
    if (!value) {
      editingDirty.value = false;
      editingValid.value = true;
    }
  };

  const setEditingDirty = (value: boolean) => {
    editingDirty.value = value;
  };

  const setEditingValid = (value: boolean) => {
    editingValid.value = value;
  };

  const updateModel = async (payload: { name: string; description?: string; isPublic: boolean }): Promise<boolean> => {
    if (!model.value) return false;
    if (editingSubmitting.value) return false;
    editingSubmitting.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }
      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          description: payload.description ?? null,
          isPublic: payload.isPublic,
          titleFieldId: titleFieldDraftId.value,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      if (isRecord(data) && "item" in data) {
        model.value = toModelDetail(data.item);
        titleFieldDraftId.value = model.value.titleFieldId;
      } else {
        model.value = {
          ...model.value,
          name: payload.name,
          description: payload.description ?? null,
          isPublic: payload.isPublic,
          titleFieldId: titleFieldDraftId.value,
          updatedAt: new Date().toISOString(),
        };
      }

      applyTitleSelection(titleFieldDraftId.value);
      editingDirty.value = false;
      editingInline.value = false;

      toast.add({
        severity: "success",
        summary: t("models.edit.title"),
        detail: t("models.edit.success_message"),
        life: 4000,
      });
      return true;
    } catch (error) {
      console.error("Failed to update model:", error);
      const message = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.edit.error_message");
      toast.add({
        severity: "error",
        summary: t("models.edit.title"),
        detail: message,
        life: 4000,
      });
      return false;
    } finally {
      editingSubmitting.value = false;
    }
  };

  const editingFieldPayload = computed<ModelFieldEditPayload | null>(() => {
    const field = editingField.value;
    if (!field) return null;
    return {
      id: field.id,
      name: field.name,
      fieldKey: field.fieldKey,
      type: field.type,
      required: field.required,
      hasLocales: field.hasLocales,
      isUnique: field.isUnique,
      variant: field.variant,
      options: field.options,
      defaultValue: field.defaultValue,
      isPrivate: field.isPrivate,
      position: field.position,
      isDisplayTitle: field.isDisplayTitle,
    };
  });

  const handleFieldCreated = async (payload: SubmitPayload) => {
    if (creatingField.value) return;
    creatingField.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const requestBody = {
        name: payload.name,
        fieldKey: payload.fieldKey,
        type: payload.type,
        required: payload.required,
        hasLocales: payload.hasLocales,
        isUnique: payload.isUnique,
        variant: payload.variant ?? null,
        options: payload.options ?? null,
        defaultValue: payload.defaultValue ?? null,
        isPrivate: payload.isPrivate,
        position: fields.value.length,
      } as const;

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(bodyText || `Request failed with status ${res.status}`);
      }

      const data = await res.json();
      const createdField = toModelField(data);
      applyLocalOrder([...fields.value, createdField]);
      savedOrderIds.value = [...savedOrderIds.value, createdField.id];
      if (model.value) {
        const nextTitleFieldId = createdField.isDisplayTitle ? createdField.id : model.value.titleFieldId;
        model.value = {
          ...model.value,
          fieldsCount: model.value.fieldsCount + 1,
          titleFieldId: nextTitleFieldId,
        };
        if (createdField.isDisplayTitle) {
          applyTitleSelection(nextTitleFieldId);
        }
      }

      toast.add({
        severity: "success",
        summary: t("models.detail.add_field"),
        detail: t("models.detail.add_field_success"),
        life: 4000,
      });
    } catch (error) {
      console.error("Failed to create model field:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.detail.add_field_error");
      toast.add({
        severity: "error",
        summary: t("models.detail.add_field"),
        detail,
        life: 4000,
      });
    } finally {
      creatingField.value = false;
    }
  };

  const editField = (fieldId: string) => {
    const target = fields.value.find((field) => field.id === fieldId);
    if (!target) return;
    editingField.value = { ...target };
    showEditFieldDialog.value = true;
  };

  const updateFieldLocally = (payload: ModelFieldEditPayload) => {
    const nextIsDisplayTitle = payload.isDisplayTitle;
    fields.value = fields.value.map((field) => {
      if (field.id === payload.id) {
        return {
          ...field,
          name: payload.name,
          fieldKey: payload.fieldKey,
          type: payload.type,
          required: payload.required,
          hasLocales: payload.hasLocales,
          isUnique: payload.isUnique,
          variant: payload.variant,
          options: payload.options,
          defaultValue: payload.defaultValue,
          isPrivate: payload.isPrivate,
          position: payload.position ?? field.position,
          isDisplayTitle: typeof nextIsDisplayTitle === "boolean" ? nextIsDisplayTitle : field.isDisplayTitle,
        };
      }
      if (nextIsDisplayTitle === true) {
        return { ...field, isDisplayTitle: false };
      }
      return field;
    });

    if (model.value && typeof nextIsDisplayTitle === "boolean") {
      const nextTitleFieldId = nextIsDisplayTitle
        ? (payload.id ?? model.value.titleFieldId)
        : model.value.titleFieldId === payload.id
          ? null
          : model.value.titleFieldId;
      model.value = { ...model.value, titleFieldId: nextTitleFieldId };
      titleFieldDraftId.value = nextTitleFieldId;
    }
  };

  const handleFieldUpdated = async (payload: ModelFieldEditPayload) => {
    if (!payload.id) return;
    if (updatingFieldId.value) return;
    updatingFieldId.value = payload.id;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const requestBody = {
        name: payload.name,
        fieldKey: payload.fieldKey,
        type: payload.type,
        required: payload.required,
        hasLocales: payload.hasLocales,
        isUnique: payload.isUnique,
        variant: payload.variant ?? null,
        options: payload.options ?? null,
        defaultValue: payload.defaultValue ?? null,
        isPrivate: payload.isPrivate,
        position: payload.position ?? null,
        isDisplayTitle: payload.isDisplayTitle ?? false,
      } as const;

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields/${encodeResourceId(payload.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(bodyText || `Request failed with status ${res.status}`);
      }

      updateFieldLocally(payload);
      toast.add({
        severity: "success",
        summary: t("models.detail.edit_field"),
        detail: t("models.detail.edit_field_success"),
        life: 4000,
      });
    } catch (error) {
      console.error("Failed to update model field:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.detail.edit_field_error");
      toast.add({
        severity: "error",
        summary: t("models.detail.edit_field"),
        detail,
        life: 4000,
      });
    } finally {
      updatingFieldId.value = null;
    }
  };

  /** Delete a field definition after confirming the destructive schema change. */
  const deleteField = async (fieldId: string) => {
    const target = fields.value.find((field) => field.id === fieldId);
    if (!target || deletingFieldIds.value[fieldId]) return;

    const confirmed = typeof window === "undefined" || window.confirm(t("models.detail.delete_field_confirm", { name: target.name }));
    if (!confirmed) return;

    setFieldDeleting(fieldId, true);
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/fields/${encodeResourceId(fieldId)}`, {
        method: "DELETE",
      });

      if (res.status === 404) {
        throw new Error(t("models.detail.delete_field_not_found"));
      }

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(bodyText || `Request failed with status ${res.status}`);
      }

      const persistedTitleDeleted = model.value?.titleFieldId === fieldId;
      const draftTitleDeleted = titleFieldDraftId.value === fieldId;
      const nextFields = applyLocalFieldOrder(fields.value.filter((field) => field.id !== fieldId));
      const nextTitleFieldId = persistedTitleDeleted || draftTitleDeleted ? null : titleFieldDraftId.value;

      savedOrderIds.value = savedOrderIds.value.filter((id) => id !== fieldId);
      applyTitleSelection(nextTitleFieldId, nextFields);

      if (editingField.value?.id === fieldId) {
        showEditFieldDialog.value = false;
        editingField.value = null;
      }

      if (model.value) {
        model.value = {
          ...model.value,
          fieldsCount: Math.max(0, model.value.fieldsCount - 1),
          titleFieldId: persistedTitleDeleted ? null : model.value.titleFieldId,
          updatedAt: new Date().toISOString(),
        };
      }

      toast.add({
        severity: "success",
        summary: t("models.detail.delete_field"),
        detail: t("models.detail.delete_field_success"),
        life: 4000,
      });
    } catch (error) {
      console.error("Failed to delete model field:", error);
      const detail = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.detail.delete_field_error");
      toast.add({
        severity: "error",
        summary: t("models.detail.delete_field"),
        detail,
        life: 4000,
      });
    } finally {
      setFieldDeleting(fieldId, false);
    }
  };

  const loadDependencies = async () => {
    dependenciesLoading.value = true;
    dependenciesError.value = null;
    dependencies.value = [];
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }
      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}/dependencies`);
      if (res.status === 404) {
        dependenciesError.value = t("models.detail.delete_dialog.not_found");
        return;
      }
      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(bodyText || `Request failed with status ${res.status}`);
      }
      const payload = await res.json();
      if (!isRecord(payload) || !Array.isArray(payload.dependencies)) {
        dependencies.value = [];
        return;
      }
      dependencies.value = payload.dependencies.map((item) => toModelDependency(item)).filter((item): item is ModelDependency => item !== null);
    } catch (error) {
      console.error("Failed to fetch model dependencies:", error);
      const message = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.detail.delete_dialog.dependencies_error");
      dependenciesError.value = message;
    } finally {
      dependenciesLoading.value = false;
    }
  };

  const refreshDependencies = async () => {
    if (dependenciesLoading.value) return;
    await loadDependencies();
  };

  const openDeleteDialog = () => {
    showDeleteDialog.value = true;
  };

  const performDelete = async () => {
    if (!canDeleteModel.value || deletingModel.value) return;
    deletingModel.value = true;
    try {
      if (!authStore.accessToken) {
        await authStore.refresh().catch(() => undefined);
      }

      const res = await authorizedFetch(authStore, `/api/admin/models/${encodeResourceId(modelId)}`, {
        method: "DELETE",
      });

      if (res.status === 409) {
        const payload = await res.json().catch(() => null);
        if (isRecord(payload) && Array.isArray(payload.dependencies)) {
          dependencies.value = payload.dependencies.map((item) => toModelDependency(item)).filter((item): item is ModelDependency => item !== null);
        }
        dependenciesError.value = t("models.detail.delete_dialog.blocked");
        deletingModel.value = false;
        return;
      }

      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(bodyText || `Request failed with status ${res.status}`);
      }

      toast.add({
        severity: "success",
        summary: t("models.detail.delete_dialog.success_title"),
        detail: t("models.detail.delete_dialog.success_message"),
        life: 4000,
      });

      showDeleteDialog.value = false;
      router.push("/models");
    } catch (error) {
      console.error("Failed to delete model:", error);
      const message = error instanceof Error && error.message.trim().length > 0 ? error.message : t("models.detail.delete_dialog.delete_error");
      toast.add({
        severity: "error",
        summary: t("models.detail.delete_dialog.error_title"),
        detail: message,
        life: 4000,
      });
    } finally {
      deletingModel.value = false;
    }
  };

  const canDeleteModel = computed(() => !dependenciesLoading.value && dependencies.value.length === 0);

  const setTitleField = (fieldId: string | null) => {
    applyTitleSelection(fieldId);
  };

  onMounted(async () => {
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }
    setupRouteLeaveGuard();
    await fetchModel();
    if (!errorMessage.value) {
      await fetchFields();
    }
  });

  onBeforeUnmount(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
    if (typeof removeRouteGuard === "function") {
      removeRouteGuard();
      removeRouteGuard = null;
    }
  });

  watch(showEditFieldDialog, (visible) => {
    if (!visible) {
      editingField.value = null;
    }
  });

  watch(showDeleteDialog, (visible) => {
    if (visible) {
      void loadDependencies();
    } else {
      dependencies.value = [];
      dependenciesError.value = null;
      dependenciesLoading.value = false;
    }
  });

  return {
    model,
    fields,
    loading,
    errorMessage,
    formattedCreatedAt,
    formattedUpdatedAt,
    modelForm,
    editingInline,
    editingSubmitting,
    editingValid,
    showAddFieldDialog,
    showEditFieldDialog,
    editingFieldPayload,
    deletingFieldIds,
    showDeleteDialog,
    deletingModel,
    dependenciesLoading,
    dependenciesError,
    dependencies,
    hasUnsavedOrderChanges,
    hasUnsavedChanges,
    editingDirty,
    titleFieldDirty,
    titleFieldDraftId,
    applyingOrder,
    canDeleteModel,
    addField,
    editField,
    deleteField,
    handleFieldCreated,
    handleFieldUpdated,
    handleRowReorder,
    applyFieldOrder,
    resetFieldOrder,
    updateModel,
    setTitleField,
    setEditingInline,
    setEditingDirty,
    setEditingValid,
    syncTitleSelection,
    applyTitleSelection,
    openDeleteDialog,
    performDelete,
    refreshDependencies,
  };
}
