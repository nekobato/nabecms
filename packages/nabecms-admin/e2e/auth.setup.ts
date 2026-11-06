/**
 * Initializes a fresh reference Worker and captures the authenticated Admin state.
 * @module e2e/auth-setup
 */
import { expect, test as setup } from "@playwright/test";
import { getAuthStatePath, getWorkerOrigin, requireE2eEnv } from "./support.js";

setup("initialize and sign in to the reference Worker", async ({ page }) => {
  const origin = getWorkerOrigin();
  const adminEmail = requireE2eEnv("NABECMS_E2E_ADMIN_EMAIL");
  const adminPassword = requireE2eEnv("NABECMS_E2E_ADMIN_PASSWORD");
  const bootstrapSecret = requireE2eEnv("NABECMS_E2E_BOOTSTRAP_SECRET");

  const deepLinkResponse = await page.goto(`${origin}/admin/auth/initialize`);
  expect(deepLinkResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Create First Admin" })).toBeVisible();

  await page.locator("#name").fill("Release Administrator");
  await page.locator("#email").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.locator("#bootstrapSecret").fill(bootstrapSecret);
  await page.locator("#defaultLocale").fill("en");

  const initializeResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/admin/auth/initialize") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create admin", exact: true }).click();
  expect((await initializeResponsePromise).status()).toBe(201);
  await expect(page).toHaveURL(/\/admin\/auth\/login$/u);

  await page.locator("#email").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/$/u);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();

  const sessionResponse = await page.request.get("/api/auth/get-session");
  expect(sessionResponse.status()).toBe(200);
  await page.context().storageState({ path: getAuthStatePath() });
});
