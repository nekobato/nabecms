import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

const CustomPage = defineComponent({
  name: "CustomPage",
  template: "<div>Custom</div>",
});

beforeEach(() => {
  vi.resetModules();
});

describe("admin extension registry", () => {
  it("normalizes host-owned sidebar and settings pages", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.doMock("@app-admin-extensions", () => ({
      appAdminExtensions: {
        sidebarPages: [
          {
            id: "custom-insights",
            label: "Insights",
            icon: "lucide:chart-line",
            path: "/insights",
            routeName: "custom-insights",
            component: CustomPage,
            order: 20,
          },
        ],
        settingsPages: [
          {
            id: "settings-branding",
            label: "Branding",
            icon: "lucide:palette",
            path: "branding",
            routeName: "settings-branding",
            component: CustomPage,
            order: 10,
          },
        ],
        themeTokens: {
          "--app-bg": "#ffffff",
        },
      },
    }));

    const { adminSettingsPageExtensions, adminSidebarPageExtensions, applyAdminThemeTokens } = await import("./admin-extensions");

    expect(warn).toHaveBeenCalledWith(
      "[nabecms-admin] Host app admin extensions are an internal prototype in v1 and are not covered by compatibility guarantees.",
    );

    expect(adminSidebarPageExtensions).toEqual([
      expect.objectContaining({
        id: "custom-insights",
        path: "/insights",
        order: 20,
      }),
    ]);
    expect(adminSettingsPageExtensions).toEqual([
      expect.objectContaining({
        id: "settings-branding",
        path: "branding",
        fullPath: "/settings/branding",
      }),
    ]);

    const style = {
      setProperty: vi.fn(),
    } as unknown as CSSStyleDeclaration;
    applyAdminThemeTokens(style);

    expect(style.setProperty).toHaveBeenCalledWith("--app-bg", "#ffffff");
  });

  it("rejects reserved settings paths", async () => {
    vi.doMock("@app-admin-extensions", () => ({
      appAdminExtensions: {
        settingsPages: [
          {
            id: "settings-users-clone",
            label: "Users Clone",
            icon: "lucide:user",
            path: "users",
            routeName: "settings-users-clone",
            component: CustomPage,
          },
        ],
      },
    }));

    await expect(import("./admin-extensions")).rejects.toThrow('Admin settings page "settings-users-clone" path "users" is reserved or invalid');
  });
});
