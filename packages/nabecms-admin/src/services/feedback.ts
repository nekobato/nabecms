import { h } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

/** Severity values accepted by the application feedback service. */
export type FeedbackSeverity = "success" | "info" | "warn" | "warning" | "error" | "danger" | "secondary" | "contrast";

/** Toast payload shared by Admin UI features. */
export type ToastPayload = {
  severity?: FeedbackSeverity;
  summary?: string;
  detail?: string;
  life?: number;
  closable?: boolean;
};

/** Confirmation payload shared by Admin UI features. */
export type ConfirmPayload = {
  header?: string;
  message: string;
  icon?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  accept?: () => void | Promise<void>;
  reject?: () => void;
  onHide?: () => void;
};

/** Map application feedback severities to Element Plus message types. */
const resolveMessageType = (severity: FeedbackSeverity | undefined): "success" | "info" | "warning" | "error" => {
  if (severity === "warn" || severity === "warning") return "warning";
  if (severity === "danger" || severity === "error") return "error";
  if (severity === "success") return "success";
  return "info";
};

/** Display application toast notifications through Element Plus. */
export const useToast = () => ({
  add: (payload: ToastPayload) =>
    ElMessage({
      type: resolveMessageType(payload.severity),
      duration: payload.life ?? 3000,
      showClose: payload.closable ?? true,
      grouping: true,
      message: h("div", { class: "nabe-toast" }, [
        payload.summary ? h("strong", { class: "nabe-toast__summary" }, payload.summary) : null,
        payload.detail ? h("span", { class: "nabe-toast__detail" }, payload.detail) : null,
      ]),
    }),
});

/** Display application confirmation prompts through Element Plus. */
export const useConfirm = () => ({
  require: (payload: ConfirmPayload) => {
    void ElMessageBox.confirm(payload.message, payload.header ?? "", {
      confirmButtonText: payload.acceptLabel,
      cancelButtonText: payload.rejectLabel,
      distinguishCancelAndClose: true,
      customClass: "nabe-confirm-dialog",
      type: payload.icon?.includes("trash") ? "error" : "warning",
    })
      .then(() => payload.accept?.())
      .catch((action: unknown) => {
        if (action === "cancel") payload.reject?.();
      })
      .finally(() => payload.onHide?.());
  },
});
