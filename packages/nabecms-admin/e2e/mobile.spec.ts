/**
 * Mobile navigation, dialog, and unsaved-change smoke for the release Worker.
 * @module e2e/mobile-release-smoke
 */
import { expect, test, type Page } from "@playwright/test";
import { getWorkerOrigin, readReleaseState } from "./support.js";

/** Open the mobile drawer and return its visible navigation region. */
const openMobileNavigation = async (page: Page) => {
  const toggle = page.getByRole("button", { name: "Open navigation menu" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const drawer = page.locator("#app-sidebar-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
};

/** Navigate from a dirty page and resolve its native confirmation. */
const navigateDirtyMobilePage = async (page: Page, accept: boolean): Promise<string> => {
  const drawer = await openMobileNavigation(page);
  const messagePromise = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      if (accept) await dialog.accept();
      else await dialog.dismiss();
    });
  });
  await drawer.getByRole("link", { name: "Models", exact: true }).click();
  return messagePromise;
};

test("keeps mobile navigation and dialogs within the viewport", async ({ page }) => {
  const origin = getWorkerOrigin();
  const state = await readReleaseState();

  await page.goto(`${origin}/admin/`);
  const drawer = await openMobileNavigation(page);
  await drawer.getByRole("link", { name: "Media", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/media$/u);
  await expect(page.locator("#app-sidebar-drawer")).toBeHidden();

  await page.getByRole("button", { name: "Upload Files", exact: true }).click();
  const uploadDialog = page.getByRole("dialog").filter({ hasText: "Upload Files" });
  await expect(uploadDialog).toBeVisible();
  const dialogSurface = uploadDialog.locator(".el-dialog");
  await expect(dialogSurface).toBeInViewport({ ratio: 1 });
  const dialogBox = await dialogSurface.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);
  await uploadDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(uploadDialog).toBeHidden();

  await page.goto(`${origin}/admin/contents/${state.modelId}/${state.entryId}`);
  const draftTab = page.getByRole("tab", { name: "Draft", exact: true });
  await draftTab.click();
  await expect(draftTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#draft-Title")).toBeVisible();
  await page.locator("#draft-Title").fill("Unsaved mobile value");
  expect(await navigateDirtyMobilePage(page, false)).toContain("Discard unsaved changes to these entries?");
  await expect(page).toHaveURL(new RegExp(`/admin/contents/${state.modelId}/${state.entryId}$`, "u"));
  expect(await navigateDirtyMobilePage(page, true)).toContain("Discard unsaved changes to these entries?");
  await expect(page).toHaveURL(/\/admin\/models$/u);
});
