import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../locales/en.json";
import { resizeImageToTemplate } from "@/utils/imageVariants";
import MediaSettingsDialog from "./MediaSettingsDialog.vue";

const fetchMediaSettingsMock = vi.fn();
const updateMediaSettingsMock = vi.fn();
const toastAddMock = vi.fn();

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    accessToken: "token",
    refresh: vi.fn(),
  }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

vi.mock("@/services/mediaSettings", () => ({
  fetchMediaSettings: (...args: unknown[]) => fetchMediaSettingsMock(...args),
  updateMediaSettings: (...args: unknown[]) => updateMediaSettingsMock(...args),
}));

vi.mock("@/utils/imageVariants", () => ({
  resizeImageToTemplate: vi.fn(),
}));

const resizeImageToTemplateMock = vi.mocked(resizeImageToTemplate);

/**
 * Create an i18n instance for component tests.
 */
const createI18nInstance = () =>
  createI18n({
    legacy: false,
    locale: "en",
    fallbackLocale: "en",
    missingWarn: false,
    fallbackWarn: false,
    messages: { en },
  });

/**
 * Render a lightweight Dialog stub that exposes slots inline.
 */
const DialogStub = defineComponent({
  name: "TestDialogStub",
  setup(_, { slots }) {
    return () => h("div", { "data-stub": "Dialog" }, [slots.default?.(), slots.footer?.()]);
  },
});

/**
 * Render a native select element from the select adapter props.
 */
const SelectStub = defineComponent({
  name: "TestSelectStub",
  props: {
    modelValue: { type: [String, Number, Object], default: undefined },
    options: { type: Array, default: () => [] },
    optionLabel: { type: [String, Function], default: "label" },
    optionValue: { type: [String, Function], default: "value" },
    optionDisabled: { type: [String, Function], default: null },
  },
  emits: ["update:modelValue"],
  setup(props, { emit, attrs }) {
    return () =>
      h(
        "select",
        {
          ...attrs,
          value: props.modelValue,
          onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLSelectElement).value),
        },
        (props.options as Array<Record<string, unknown>>).map((option) => {
          const label = typeof props.optionLabel === "function" ? props.optionLabel(option) : option[props.optionLabel];
          const value = typeof props.optionValue === "function" ? props.optionValue(option) : option[props.optionValue];
          const disabled =
            typeof props.optionDisabled === "function"
              ? Boolean(props.optionDisabled(option))
              : typeof props.optionDisabled === "string"
                ? Boolean(option[props.optionDisabled])
                : false;

          return h("option", { value, disabled }, String(label ?? value ?? ""));
        }),
      );
  },
});

/**
 * Render a minimal Button stub for interaction-free tests.
 */
const ButtonStub = defineComponent({
  name: "TestButtonStub",
  props: {
    label: { type: String, default: "" },
  },
  emits: ["click"],
  setup(props, { emit, slots, attrs }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: "button",
          onClick: () => emit("click"),
        },
        slots.default?.() ?? props.label,
      );
  },
});

describe("MediaSettingsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMediaSettingsMock.mockResolvedValue({
      transformMode: "cloudflare",
      templates: [],
      cloudflare: { enabled: false },
    });
    updateMediaSettingsMock.mockResolvedValue({
      transformMode: "frontend",
      templates: [],
      cloudflare: { enabled: false },
    });
  });

  it("disables Cloudflare transform mode when the API marks it unavailable", async () => {
    const wrapper = mount(MediaSettingsDialog, {
      props: { visible: false },
      global: {
        plugins: [createI18nInstance()],
        stubs: {
          Dialog: DialogStub,
          Select: SelectStub,
          Button: ButtonStub,
          InputText: true,
          InputNumber: true,
          Checkbox: true,
        },
      },
    });

    await wrapper.setProps({ visible: true });
    await flushPromises();

    const transformModeSelect = wrapper.get("select");
    const cloudflareOption = transformModeSelect.get('option[value="cloudflare"]');

    expect((transformModeSelect.element as HTMLSelectElement).value).toBe("frontend");
    expect(cloudflareOption.attributes("disabled")).toBeDefined();
  });

  it("refreshes the preview automatically when a sample file is selected", async () => {
    const urlObjectUrlMethods = URL as typeof URL & {
      createObjectURL?: (object: Blob | MediaSource) => string;
      revokeObjectURL?: (url: string) => void;
    };
    const originalCreateObjectURL = urlObjectUrlMethods.createObjectURL;
    const originalRevokeObjectURL = urlObjectUrlMethods.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:variant-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    fetchMediaSettingsMock.mockResolvedValueOnce({
      transformMode: "frontend",
      templates: [{ key: "thumb", label: "Thumb", width: 120, height: 80, fit: "cover", format: "webp", quality: 80, upscale: false }],
      cloudflare: { enabled: false },
    });
    resizeImageToTemplateMock.mockResolvedValue({
      blob: new Blob(["preview"], { type: "image/webp" }),
      width: 120,
      height: 80,
      format: "webp",
    });

    try {
      const wrapper = mount(MediaSettingsDialog, {
        props: { visible: false },
        global: {
          plugins: [createI18nInstance()],
          stubs: {
            Dialog: DialogStub,
            Select: SelectStub,
            Button: ButtonStub,
            InputText: true,
            InputNumber: true,
            Checkbox: true,
          },
        },
      });

      await wrapper.setProps({ visible: true });
      await flushPromises();
      const file = new File(["sample"], "sample.png", { type: "image/png" });
      const input = wrapper.get('input[type="file"]');
      Object.defineProperty(input.element, "files", {
        configurable: true,
        value: [file],
      });
      await input.trigger("change");
      await flushPromises();

      expect(wrapper.text()).not.toContain("Refresh preview");
      expect(resizeImageToTemplateMock).toHaveBeenCalledWith(
        file,
        expect.objectContaining({
          key: "thumb",
        }),
      );
      expect(wrapper.text()).toContain("120×80");
    } finally {
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, "createObjectURL", {
          configurable: true,
          value: originalCreateObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, "createObjectURL");
      }

      if (originalRevokeObjectURL) {
        Object.defineProperty(URL, "revokeObjectURL", {
          configurable: true,
          value: originalRevokeObjectURL,
        });
      } else {
        Reflect.deleteProperty(URL, "revokeObjectURL");
      }
    }
  });
});
