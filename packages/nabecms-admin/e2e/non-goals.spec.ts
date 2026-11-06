/**
 * Negative release smoke for v1 features that must remain unavailable.
 * @module e2e/non-goals-smoke
 */
import { expect, test } from "@playwright/test";
import { getWorkerOrigin } from "./support.js";

const unsupportedRoutes = [
  { method: "GET", path: "/api/admin/auth/providers" },
  { method: "GET", path: "/api/admin/auth/turnstile/config" },
  { method: "GET", path: "/api/admin/publication-schedules" },
  { method: "GET", path: "/api/admin/webhooks" },
] as const;

test("keeps v1 non-goal routes and login controls unavailable", async ({ browser, page }) => {
  for (const route of unsupportedRoutes) {
    const response = await page.request.fetch(route.path, {
      method: route.method,
    });
    expect(response.status(), `${route.method} ${route.path}`).toBe(404);
  }

  const unauthenticatedContext = await browser.newContext({ baseURL: getWorkerOrigin() });
  try {
    const loginPage = await unauthenticatedContext.newPage();
    await loginPage.goto("/admin/auth/login");
    await expect(loginPage.getByRole("heading", { name: "NabeCMS" })).toBeVisible();
    await expect(loginPage.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    await expect(loginPage.locator('[data-test="turnstile-widget"]')).toHaveCount(0);
    await expect(loginPage.getByRole("button", { name: /google/iu })).toHaveCount(0);
  } finally {
    await unauthenticatedContext.close();
  }
});
