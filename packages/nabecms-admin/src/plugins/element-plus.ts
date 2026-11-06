import type { App, DirectiveBinding, ObjectDirective } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";

/** Resolve the visible text used by the lightweight owned tooltip directive. */
const resolveTooltipText = (binding: DirectiveBinding<string | { value?: string; disabled?: boolean }>) => {
  if (typeof binding.value === "string") return binding.value;
  return binding.value?.disabled ? "" : (binding.value?.value ?? "");
};

/** Keep the native tooltip text synchronized for icon-only controls. */
const tooltipDirective: ObjectDirective<HTMLElement, string | { value?: string; disabled?: boolean }> = {
  mounted: (element, binding) => {
    element.title = resolveTooltipText(binding);
  },
  updated: (element, binding) => {
    element.title = resolveTooltipText(binding);
  },
};

/** Register Element Plus and Admin UI-owned directives. */
export default function registerElementPlus(app: App) {
  app.use(ElementPlus);
  app.directive("tooltip", tooltipDirective);
}
