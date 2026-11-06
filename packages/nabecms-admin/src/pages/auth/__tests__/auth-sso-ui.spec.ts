import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, reactive } from "vue";
import ja from "@/locales/ja.json";
import en from "@/locales/en.json";
import LoginPage from "../LoginPage.vue";
import InitializePage from "../InitializePage.vue";
import InviteAcceptPage from "../InviteAcceptPage.vue";

const routeState = reactive<{
  path: string;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
}>({
  path: "/auth/login",
  query: {},
  params: {},
});

const pushMock = vi.fn();
const toastAddMock = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: pushMock, replace: pushMock }),
}));

vi.mock("@/services/feedback", () => ({
  useToast: () => ({ add: toastAddMock }),
}));

const CardStub = defineComponent({
  name: "CardStub",
  setup(_props, { slots }) {
    return () => h("div", { class: "card-stub" }, [slots.header?.(), slots.content?.(), slots.default?.()]);
  },
});

const DialogStub = defineComponent({
  name: "DialogStub",
  props: {
    visible: { type: Boolean, default: false },
    header: { type: String, default: "" },
  },
  emits: ["update:visible", "hide"],
  setup(props, { attrs, slots }) {
    return () =>
      props.visible ? h("div", { ...attrs, class: ["dialog-stub", attrs.class] }, [h("h2", props.header), slots.default?.(), slots.footer?.()]) : null;
  },
});

const ButtonStub = defineComponent({
  name: "ButtonStub",
  props: {
    label: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
  },
  emits: ["click"],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        "button",
        {
          ...attrs,
          type: attrs.type ?? "button",
          disabled: props.disabled,
          onClick: (event: MouseEvent) => emit("click", event),
        },
        slots.default ? slots.default() : props.label,
      );
  },
});

const InputTextStub = defineComponent({
  name: "InputTextStub",
  props: {
    modelValue: { type: [String, Number], default: "" },
  },
  emits: ["update:modelValue", "blur"],
  setup(props, { attrs, emit }) {
    return () =>
      h("input", {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
        onBlur: () => emit("blur"),
      });
  },
});

const PasswordStub = defineComponent({
  name: "PasswordStub",
  props: {
    modelValue: { type: String, default: "" },
  },
  emits: ["update:modelValue", "blur"],
  setup(props, { emit }) {
    return () =>
      h("input", {
        type: "password",
        value: props.modelValue,
        onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
        onBlur: () => emit("blur"),
      });
  },
});

const DividerStub = defineComponent({
  name: "DividerStub",
  setup(_props, { slots }) {
    return () => h("div", { class: "divider-stub" }, slots.default?.());
  },
});

const FormStub = defineComponent({
  name: "FormStub",
  setup(_props, { slots, attrs }) {
    return () => h("form", { class: attrs.class as string | undefined }, slots.default?.());
  },
});

const FieldStub = defineComponent({
  name: "FieldStub",
  setup(_props, { slots }) {
    return () =>
      slots.default?.({
        field: {
          value: "",
          onChange: () => undefined,
          onBlur: () => undefined,
        },
        errors: [],
      });
  },
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let bootstrapPayload: Record<string, unknown>;
let providersPayload: Record<string, unknown>;
let inviteValidatePayload: { status: number; body: Record<string, unknown> };

const mountPage = (component: Parameters<typeof mount>[0]) => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const i18n = createI18n({
    legacy: false,
    locale: "ja",
    messages: { ja, en },
  });

  return mount(component, {
    global: {
      plugins: [pinia, i18n],
      stubs: {
        Card: CardStub,
        Dialog: DialogStub,
        Button: ButtonStub,
        InputText: InputTextStub,
        Password: PasswordStub,
        Divider: DividerStub,
        Form: FormStub,
        Field: FieldStub,
      },
    },
  });
};

describe("v1 local auth UI flows", () => {
  beforeEach(() => {
    pushMock.mockReset();
    toastAddMock.mockReset();
    routeState.path = "/auth/login";
    routeState.query = {};
    routeState.params = {};

    bootstrapPayload = { allowSignup: false, initialized: true };
    providersPayload = {
      ssoEnabled: true,
      providers: [
        {
          id: "google",
          enabled: true,
          flows: ["login", "invite"],
        },
      ],
    };
    inviteValidatePayload = {
      status: 200,
      body: {
        email: "invited@example.com",
        expiresAt: "2026-03-01T00:00:00.000Z",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const url = new URL(raw, "http://localhost");
        const path = url.pathname;

        if (path === "/api/admin/system/bootstrap") {
          return jsonResponse(bootstrapPayload);
        }
        if (path === "/api/admin/auth/providers") {
          return jsonResponse(providersPayload);
        }
        if (path === "/api/admin/auth/accept-invite/validate") {
          return jsonResponse(inviteValidatePayload.body, inviteValidatePayload.status);
        }
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps social providers, Turnstile, and email reset out of login", async () => {
    routeState.path = "/auth/login";
    const wrapper = mountPage(LoginPage);

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).not.toContain("Google で続行");
    expect(wrapper.find('[data-test="password-reset-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="turnstile-widget"]').exists()).toBe(false);
  });

  it("ignores obsolete social callback errors on login", async () => {
    routeState.path = "/auth/login";
    routeState.query = { code: "SIGNUP_NOT_ALLOWED" };
    const wrapper = mountPage(LoginPage);

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).not.toContain("この画面から新規登録はできません。招待経由でサインインしてください。");
  });

  it("ignores obsolete social callback errors during initialization", async () => {
    routeState.path = "/auth/initialize";
    routeState.query = { code: "INITIALIZE_VIA_SSO_DISABLED" };
    bootstrapPayload = { allowInitialize: true, initialized: false };
    const wrapper = mountPage(InitializePage);

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).not.toContain("初期管理者の作成では外部認証を利用できません。");
    expect(wrapper.text()).not.toContain("Google で続行");
  });

  it("does not expose social retry on invite acceptance", async () => {
    routeState.path = "/auth/invite";
    routeState.query = {
      token: "invite-token",
      code: "INVITE_EMAIL_MISMATCH",
    };
    const wrapper = mountPage(InviteAcceptPage);

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).not.toContain("Google で続行");
  });

  it("ignores obsolete social callback errors during invite acceptance", async () => {
    routeState.path = "/auth/invite";
    routeState.query = {
      token: "invite-token",
      code: "INVITE_REVOKED",
    };
    const wrapper = mountPage(InviteAcceptPage);

    await flushPromises();
    await flushPromises();

    expect(wrapper.text()).not.toContain("この招待は取り消されています。");
    expect(wrapper.text()).not.toContain("Google で続行");
  });
});
