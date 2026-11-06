import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

const CustomPage = defineComponent({
  name: "CustomPage",
  template: "<div>Custom route</div>",
});

beforeEach(() => {
  vi.resetModules();
});

describe("createAdminRouter", () => {
  it("keeps unsupported v1 pages out of the built-in router", async () => {
    vi.doMock("@app-admin-extensions", () => ({
      appAdminExtensions: {},
    }));

    const { createAdminRouter } = await import("./index");
    const router = createAdminRouter();
    const routeNames = new Set(router.getRoutes().map((route) => route.name));

    expect(routeNames).toContain("reset-password");
    expect(routeNames).not.toContain("settings-hooks");
  });

  it("registers host-owned sidebar and settings routes", async () => {
    vi.doMock("@app-admin-extensions", () => ({
      appAdminExtensions: {
        sidebarPages: [
          {
            id: "custom-reports",
            label: "Reports",
            icon: "lucide:chart-bar",
            path: "/reports",
            routeName: "custom-reports",
            component: CustomPage,
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
          },
        ],
      },
    }));

    const { createAdminRouter } = await import("./index");
    const router = createAdminRouter();

    expect(router.resolve("/reports").name).toBe("custom-reports");
    expect(router.resolve("/settings/branding").name).toBe("settings-branding");
  }, 15000);
});
