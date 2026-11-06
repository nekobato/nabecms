/* eslint-disable vue/multi-word-component-names, vue/no-reserved-component-names -- Public compatibility adapters retain their established component names. */
import { computed, defineComponent, h, mergeProps, ref, type CSSProperties, type PropType } from "vue";
import {
  ElAlert,
  ElAvatar,
  ElCard,
  ElCheckbox,
  ElCheckboxGroup,
  ElDatePicker,
  ElDialog,
  ElDivider,
  ElDrawer,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPopover,
  ElRadio,
  ElRadioGroup,
  ElSegmented,
  ElSelect,
  ElSkeleton,
  ElSwitch,
  ElTag,
} from "element-plus";

type SelectOption = string | number | boolean | Record<string, unknown>;
type ElementOptionValue = string | number | boolean | Record<string, unknown>;
type DatePickerValue = Date | Date[] | (Date | null)[] | string | number | null | undefined;

/** Read an option field while supporting primitive options. */
const readOptionField = (option: SelectOption, field: string | undefined, fallback: unknown) => {
  if (typeof option !== "object" || option === null) return option;
  if (!field) return fallback;
  return option[field] ?? fallback;
};

/** Resolve either the legacy inputId prop or the native id attribute. */
const resolveControlId = (attrs: Record<string, unknown>, inputId: string | undefined) => inputId ?? (typeof attrs.id === "string" ? attrs.id : undefined);

/** Convert the PrimeVue-style date tokens retained by field definitions to Day.js tokens. */
const resolveDateFormat = (format: string | undefined) => format?.replaceAll("yy", "YYYY").replaceAll("mm", "MM").replaceAll("dd", "DD");

/** Convert legacy severity names to Element Plus tag types. */
const resolveTagType = (severity: string | undefined): "primary" | "success" | "info" | "warning" | "danger" | undefined => {
  if (severity === "warn" || severity === "warning") return "warning";
  if (severity === "danger" || severity === "error") return "danger";
  if (severity === "success" || severity === "info" || severity === "primary") return severity;
  return undefined;
};

/** Card adapter preserving the Admin UI's named content slots. */
export const Card = defineComponent({
  name: "Card",
  inheritAttrs: false,
  setup:
    (_, { attrs, slots }) =>
    () =>
      h(ElCard, mergeProps(attrs, { shadow: "never" }), {
        header: slots.header ?? slots.title,
        default: slots.content ?? slots.default,
        footer: slots.footer,
      }),
});

/** Dialog adapter preserving the visible model while rendering ElDialog. */
export const Dialog = defineComponent({
  name: "Dialog",
  inheritAttrs: false,
  props: {
    visible: { type: Boolean, default: false },
    header: { type: String, default: "" },
    modal: { type: Boolean, default: true },
    draggable: { type: Boolean, default: false },
    closable: { type: Boolean, default: true },
    dismissableMask: { type: Boolean, default: false },
    closeOnEscape: { type: Boolean, default: true },
    blockScroll: { type: Boolean, default: true },
    appendTo: { type: String, default: undefined },
    breakpoints: { type: Object as PropType<Record<string, string>>, default: undefined },
    style: { type: [String, Object] as PropType<string | CSSProperties>, default: undefined },
  },
  emits: ["update:visible", "show", "hide"],
  setup: (props, { attrs, emit, slots }) => {
    const width = computed(() => (typeof props.style === "object" ? props.style?.width : undefined));
    return () =>
      h(
        ElDialog,
        mergeProps(attrs, {
          modelValue: props.visible,
          title: props.header,
          width: width.value,
          modal: props.modal,
          draggable: props.draggable,
          showClose: props.closable,
          closeOnClickModal: props.dismissableMask,
          closeOnPressEscape: props.closeOnEscape,
          lockScroll: props.blockScroll,
          style: props.style,
          appendToBody: props.appendTo !== "self",
          appendTo: "body",
          onOpen: () => emit("show"),
          onClosed: () => emit("hide"),
          "onUpdate:modelValue": (value: boolean) => emit("update:visible", value),
        }),
        slots,
      );
  },
});

const selectProps = {
  modelValue: { type: null, default: undefined },
  options: { type: Array as PropType<SelectOption[]>, default: () => [] },
  optionLabel: { type: String, default: "label" },
  optionValue: { type: String, default: "value" },
  optionDisabled: { type: String, default: "disabled" },
  placeholder: { type: String, default: undefined },
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  filter: { type: Boolean, default: false },
  showClear: { type: Boolean, default: false },
  emptyMessage: { type: String, default: undefined },
  appendTo: { type: String, default: undefined },
  overlayClass: { type: String, default: undefined },
};

/** Build Element Plus option nodes from Admin UI option records. */
const renderSelectOptions = (props: Record<string, unknown>, optionSlot: ((scope: { option: SelectOption }) => unknown) | undefined) =>
  (props.options as SelectOption[]).map((option) => {
    const label = readOptionField(option, props.optionLabel as string, String(option));
    const value = readOptionField(option, props.optionValue as string, option) as ElementOptionValue;
    const disabled = Boolean(readOptionField(option, props.optionDisabled as string, false));
    return h(ElOption, { key: String(value), label: String(label), value, disabled }, optionSlot ? { default: () => optionSlot({ option }) } : undefined);
  });

/** Single-select adapter backed by ElSelect and ElOption. */
export const Select = defineComponent({
  name: "Select",
  inheritAttrs: false,
  props: selectProps,
  emits: ["update:modelValue", "change"],
  setup:
    (props, { attrs, emit, slots }) =>
    () =>
      h(
        ElSelect,
        mergeProps(attrs, {
          modelValue: props.modelValue,
          placeholder: props.placeholder,
          disabled: props.disabled,
          loading: props.loading,
          filterable: props.filter,
          clearable: props.showClear,
          noDataText: props.emptyMessage,
          teleported: props.appendTo !== "self",
          popperClass: props.overlayClass,
          "onUpdate:modelValue": (value: unknown) => emit("update:modelValue", value),
          onChange: (value: unknown) => emit("change", value),
        }),
        { default: () => renderSelectOptions(props, slots.option) },
      ),
});

/** Multi-select adapter backed by ElSelect. */
export const MultiSelect = defineComponent({
  name: "MultiSelect",
  inheritAttrs: false,
  props: {
    ...selectProps,
    maxSelectedLabels: { type: Number, default: undefined },
    selectedItemsLabel: { type: String, default: undefined },
  },
  emits: ["update:modelValue", "change"],
  setup:
    (props, { attrs, emit, slots }) =>
    () =>
      h(
        ElSelect,
        mergeProps(attrs, {
          modelValue: props.modelValue,
          multiple: true,
          placeholder: props.placeholder,
          disabled: props.disabled,
          loading: props.loading,
          filterable: props.filter,
          clearable: props.showClear,
          collapseTags: props.maxSelectedLabels !== undefined,
          maxCollapseTags: props.maxSelectedLabels,
          collapseTagsTooltip: true,
          noDataText: props.emptyMessage,
          teleported: props.appendTo !== "self",
          popperClass: props.overlayClass,
          "onUpdate:modelValue": (value: unknown) => emit("update:modelValue", value),
          onChange: (value: unknown) => emit("change", value),
        }),
        { default: () => renderSelectOptions(props, slots.option) },
      ),
});

/** Listbox adapter rendered as an always-visible radio or checkbox group. */
export const Listbox = defineComponent({
  name: "Listbox",
  inheritAttrs: false,
  props: {
    ...selectProps,
    multiple: { type: Boolean, default: false },
  },
  emits: ["update:modelValue"],
  setup:
    (props, { attrs, emit }) =>
    () => {
      const groupProps = mergeProps(attrs, {
        modelValue: props.modelValue,
        disabled: props.disabled,
        class: [attrs.class, "nabe-listbox"],
        "onUpdate:modelValue": (value: unknown) => emit("update:modelValue", value),
      });
      const renderOptions = (multiple: boolean) =>
        props.options.map((option) => {
          const label = readOptionField(option, props.optionLabel, String(option));
          const value = readOptionField(option, props.optionValue, option) as string | number;
          const disabled = Boolean(readOptionField(option, props.optionDisabled, false));
          return multiple
            ? h(ElCheckbox, { key: String(value), value, disabled }, { default: () => String(label) })
            : h(ElRadio, { key: String(value), value, disabled }, { default: () => String(label) });
        });
      return props.multiple
        ? h(ElCheckboxGroup, groupProps, { default: () => renderOptions(true) })
        : h(ElRadioGroup, groupProps, { default: () => renderOptions(false) });
    },
});

/** Text input adapter backed by ElInput. */
export const InputText = defineComponent({
  name: "InputText",
  inheritAttrs: false,
  setup:
    (_, { attrs, slots }) =>
    () =>
      h(ElInput, attrs, slots),
});

/** Multiline text adapter backed by ElInput. */
export const Textarea = defineComponent({
  name: "Textarea",
  inheritAttrs: false,
  props: {
    modelValue: { type: [String, Number], default: "" },
    autoResize: { type: Boolean, default: false },
    rows: { type: [String, Number], default: undefined },
  },
  emits: ["update:modelValue"],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h(
        ElInput,
        mergeProps(attrs, {
          type: "textarea",
          modelValue: props.modelValue,
          autosize: props.autoResize,
          rows: props.rows === undefined ? undefined : Number(props.rows),
          "onUpdate:modelValue": (value: string) => emit("update:modelValue", value),
        }),
      ),
});

/** Password input adapter backed by ElInput. */
export const Password = defineComponent({
  name: "Password",
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: "" },
    toggleMask: { type: Boolean, default: false },
    inputId: { type: String, default: undefined },
  },
  emits: ["update:modelValue"],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h(
        ElInput,
        mergeProps(attrs, {
          id: resolveControlId(attrs, props.inputId),
          type: "password",
          showPassword: props.toggleMask,
          modelValue: props.modelValue,
          "onUpdate:modelValue": (value: string) => emit("update:modelValue", value),
        }),
      ),
});

/** Number input adapter mapping inputId to the native control. */
export const InputNumber = defineComponent({
  name: "InputNumber",
  inheritAttrs: false,
  props: {
    modelValue: { type: null as unknown as PropType<number | null | undefined>, default: undefined },
    inputId: { type: String, default: undefined },
  },
  emits: ["update:modelValue"],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h(
        ElInputNumber,
        mergeProps(attrs, {
          id: resolveControlId(attrs, props.inputId),
          modelValue: props.modelValue ?? undefined,
          "onUpdate:modelValue": (value: number | undefined) => emit("update:modelValue", value ?? null),
        }),
      ),
});

/** Binary checkbox adapter backed by ElCheckbox. */
export const Checkbox = defineComponent({
  name: "Checkbox",
  inheritAttrs: false,
  props: {
    modelValue: { type: [Boolean, Array] as PropType<boolean | unknown[]>, default: false },
    inputId: { type: String, default: undefined },
  },
  emits: ["update:modelValue", "change"],
  setup:
    (props, { attrs, emit, slots }) =>
    () =>
      h(
        ElCheckbox,
        mergeProps(attrs, {
          id: resolveControlId(attrs, props.inputId),
          modelValue: props.modelValue,
          "onUpdate:modelValue": (value: unknown) => emit("update:modelValue", value),
          onChange: (value: unknown) => emit("change", value),
        }),
        slots,
      ),
});

/** Boolean switch adapter backed by ElSwitch. */
export const ToggleSwitch = defineComponent({
  name: "ToggleSwitch",
  inheritAttrs: false,
  props: { modelValue: { type: Boolean, default: false }, inputId: { type: String, default: undefined } },
  emits: ["update:modelValue", "change"],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h(
        ElSwitch,
        mergeProps(attrs, {
          id: resolveControlId(attrs, props.inputId),
          modelValue: props.modelValue,
          "onUpdate:modelValue": (value: string | number | boolean) => emit("update:modelValue", Boolean(value)),
          onChange: (value: string | number | boolean) => emit("change", Boolean(value)),
        }),
      ),
});
export const InputSwitch = ToggleSwitch;

/** Radio adapter mapping inputId to the native radio. */
export const RadioButton = defineComponent({
  name: "RadioButton",
  inheritAttrs: false,
  props: {
    modelValue: { type: null as unknown as PropType<string | number | boolean | null>, default: null },
    value: { type: [String, Number, Boolean] as PropType<string | number | boolean>, required: true },
    inputId: { type: String, default: undefined },
  },
  emits: ["update:modelValue", "change"],
  setup:
    (props, { attrs, emit, slots }) =>
    () =>
      h(
        ElRadio,
        mergeProps(attrs, {
          id: resolveControlId(attrs, props.inputId),
          modelValue: props.modelValue ?? undefined,
          value: props.value,
          "onUpdate:modelValue": (value: string | number | boolean) => emit("update:modelValue", value),
          onChange: (value: string | number | boolean) => emit("change", value),
        }),
        slots,
      ),
});

/** Segmented-choice adapter backed by ElSegmented. */
export const SelectButton = defineComponent({
  name: "SelectButton",
  inheritAttrs: false,
  props: {
    modelValue: { type: null, default: undefined },
    options: { type: Array as PropType<SelectOption[]>, default: () => [] },
    optionLabel: { type: String, default: "label" },
    optionValue: { type: String, default: "value" },
  },
  emits: ["update:modelValue"],
  setup: (props, { attrs, emit }) => {
    const options = computed(() =>
      props.options.map((option) => ({
        label: String(readOptionField(option, props.optionLabel, option)),
        value: readOptionField(option, props.optionValue, option),
      })),
    );
    return () =>
      h(
        ElSegmented,
        mergeProps(attrs, {
          modelValue: props.modelValue,
          options: options.value,
          "onUpdate:modelValue": (value: unknown) => emit("update:modelValue", value),
        }),
      );
  },
});

/** Date input adapter backed by ElDatePicker. */
export const DatePicker = defineComponent({
  name: "DatePicker",
  inheritAttrs: false,
  props: {
    modelValue: { type: [Date, Array, String, Number] as PropType<DatePickerValue>, default: undefined },
    dateFormat: { type: String, default: undefined },
    showIcon: { type: Boolean, default: false },
    inputId: { type: String, default: undefined },
  },
  emits: ["update:modelValue"],
  setup:
    (props, { attrs, emit }) =>
    () =>
      h(
        ElDatePicker,
        mergeProps(attrs, {
          id: resolveControlId(attrs, props.inputId),
          modelValue: props.modelValue,
          format: resolveDateFormat(props.dateFormat),
          "onUpdate:modelValue": (value: unknown) => emit("update:modelValue", value),
        }),
      ),
});

/** Status tag adapter backed by ElTag. */
export const Tag = defineComponent({
  name: "Tag",
  inheritAttrs: false,
  props: {
    value: { type: [String, Number], default: undefined },
    severity: { type: String, default: undefined },
    rounded: { type: Boolean, default: false },
  },
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(ElTag, mergeProps(attrs, { type: resolveTagType(props.severity), round: props.rounded }), {
        default: slots.default ?? (() => String(props.value ?? "")),
      }),
});

/** Standalone badge adapter backed by ElTag. */
export const Badge = defineComponent({
  name: "Badge",
  inheritAttrs: false,
  props: { value: { type: [String, Number], default: "" } },
  setup:
    (props, { attrs }) =>
    () =>
      h(ElTag, mergeProps(attrs, { size: "small", round: true }), { default: () => String(props.value) }),
});

/** Avatar adapter preserving text labels. */
export const Avatar = defineComponent({
  name: "Avatar",
  inheritAttrs: false,
  props: {
    label: { type: String, default: "" },
    shape: { type: String, default: "circle" },
    size: { type: [String, Number], default: undefined },
  },
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(ElAvatar, mergeProps(attrs, { shape: props.shape === "circle" ? "circle" : "square", size: props.size === "normal" ? "default" : props.size }), {
        default: slots.default ?? (() => props.label),
      }),
});

/** Skeleton adapter preserving explicit placeholder height. */
export const Skeleton = defineComponent({
  name: "Skeleton",
  inheritAttrs: false,
  props: { height: { type: String, default: undefined } },
  setup:
    (props, { attrs }) =>
    () =>
      h(ElSkeleton, mergeProps(attrs, { animated: true, style: { height: props.height } })),
});

/** Inline message adapter backed by ElAlert. */
export const Message = defineComponent({
  name: "Message",
  inheritAttrs: false,
  props: { severity: { type: String, default: "info" }, closable: { type: Boolean, default: false } },
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(ElAlert, mergeProps(attrs, { type: resolveTagType(props.severity) ?? "info", closable: props.closable, showIcon: true }), { default: slots.default }),
});

/** Divider adapter translating the retained PrimeVue layout prop to ElDivider. */
export const Divider = defineComponent({
  name: "Divider",
  inheritAttrs: false,
  props: {
    layout: { type: String as PropType<"horizontal" | "vertical">, default: "horizontal" },
  },
  setup:
    (props, { attrs, slots }) =>
    () =>
      h(ElDivider, mergeProps(attrs, { direction: props.layout }), slots),
});

/** Drawer adapter preserving the visible model and container slot. */
export const Drawer = defineComponent({
  name: "Drawer",
  inheritAttrs: false,
  props: {
    visible: { type: Boolean, default: false },
    position: { type: String, default: "right" },
    modal: { type: Boolean, default: true },
    dismissableMask: { type: Boolean, default: true },
    closeOnEscape: { type: Boolean, default: true },
    blockScroll: { type: Boolean, default: true },
    style: { type: [String, Object] as PropType<string | CSSProperties>, default: undefined },
  },
  emits: ["update:visible"],
  setup: (props, { attrs, emit, slots }) => {
    const direction = computed(() => ({ left: "ltr", right: "rtl", top: "ttb", bottom: "btt" })[props.position] ?? "rtl");
    const size = computed(() => (typeof props.style === "object" ? props.style?.width : undefined));
    return () =>
      h(
        ElDrawer,
        mergeProps(attrs, {
          modelValue: props.visible,
          direction: direction.value,
          size: size.value,
          modal: props.modal,
          closeOnClickModal: props.dismissableMask,
          closeOnPressEscape: props.closeOnEscape,
          lockScroll: props.blockScroll,
          withHeader: false,
          appendToBody: true,
          "onUpdate:modelValue": (value: boolean) => emit("update:visible", value),
        }),
        { default: slots.container ?? slots.default },
      );
  },
});

/** Popover adapter using Element Plus virtual triggering for existing event anchors. */
export const Popover = defineComponent({
  name: "Popover",
  inheritAttrs: false,
  setup: (_, { attrs, expose, slots }) => {
    const visible = ref(false);
    const trigger = ref<HTMLElement>();
    const hide = () => {
      visible.value = false;
    };
    const toggle = (event: Event) => {
      trigger.value = event.currentTarget as HTMLElement;
      visible.value = !visible.value;
    };
    expose({ hide, toggle });
    return () =>
      h(
        ElPopover,
        mergeProps(attrs, {
          visible: visible.value,
          virtualRef: trigger.value,
          virtualTriggering: true,
          trigger: "click",
          teleported: true,
          "onUpdate:visible": (value: boolean) => (visible.value = value),
        }),
        { default: slots.default },
      );
  },
});
