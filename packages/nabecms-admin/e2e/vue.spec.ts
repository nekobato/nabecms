/// <reference types="node" />

/**
 * Product-real desktop release smoke against the reference Worker static assets.
 * @module e2e/desktop-release-smoke
 */
import { Buffer } from "node:buffer";
import { expect, test, type Page, type Response } from "@playwright/test";
import { adminRequest, getAdminAccessToken, getWorkerOrigin, readJson, writeReleaseState } from "./support.js";

type ModelResponse = { item: { id: string } };
type FieldResponse = { id: string };
type EntryResponse = { item: { id: string } };
type MediaResponse = { items: Array<{ id: string; mimeType: string; size: number }> };

const modelName = "Release Smoke Article";
const entryTitle = "Hello release smoke";

/** Wait for one mutating API response emitted by the Admin UI. */
const waitForMutation = (page: Page, pathSuffix: string, method: string): Promise<Response> =>
  page.waitForResponse((response) => response.url().endsWith(pathSuffix) && response.request().method() === method);

/** Exercise and resolve one native unsaved-change confirmation. */
const navigateWithUnsavedDecision = async (page: Page, accept: boolean): Promise<string> => {
  const messagePromise = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.message());
      if (accept) await dialog.accept();
      else await dialog.dismiss();
    });
  });
  await page.getByRole("link", { name: "Models", exact: true }).click();
  return messagePromise;
};

test("covers the v1 desktop release path", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const origin = getWorkerOrigin();

  await test.step("serve Admin assets and a deep link through the Worker", async () => {
    const response = await page.goto(`${origin}/admin/models/create`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Create Model" })).toBeVisible();

    const health = await page.request.get(`${origin}/api/contents/health`);
    expect(health.status()).toBe(200);
    expect(health.headers()["content-type"]).toContain("application/json");
    expect(await health.json()).toMatchObject({ status: "ok", service: "contents-api" });

    const robots = await page.request.get(`${origin}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toContain("text/plain");
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");

    const root = await page.request.get(`${origin}/`);
    expect(root.status()).toBe(200);
    expect(root.headers()["content-type"]).toContain("text/plain");
    expect(await root.text()).toBe("Hello Hono!");

    const adminAssetPath = await page.locator('script[type="module"][src^="/admin/assets/"]').first().getAttribute("src");
    expect(adminAssetPath).not.toBeNull();
    const rootAssetAlias = await page.request.get(`${origin}${adminAssetPath!.replace(/^\/admin/u, "")}`);
    expect(rootAssetAlias.status()).toBe(404);
    expect((await page.request.get(`${origin}/not-a-nabecms-route`)).status()).toBe(404);
  });

  const modelId = await test.step("create a public model in the Admin UI", async () => {
    await page.locator("#name").fill(modelName);
    await page.locator("#description").fill("Release browser smoke model");
    await expect(page.locator("#isPublic")).toBeChecked();
    const responsePromise = waitForMutation(page, "/api/admin/models", "POST");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const body = await readJson<ModelResponse>(response);
    await expect(page).toHaveURL(new RegExp(`/admin/models/${body.item.id}$`, "u"));
    return body.item.id;
  });

  const fieldId = await test.step("add the title field through the field dialog", async () => {
    await page.getByRole("button", { name: "Add Field", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator(".afd-card").filter({ hasText: "Text" }).first().click();
    await dialog.locator("#field-name").fill("Title");
    await dialog.locator("#field-key").fill("title");
    await dialog
      .locator(".el-select__wrapper")
      .filter({ has: page.locator("#field-variant") })
      .click();
    await page.getByRole("option", { name: "Short text", exact: true }).click();

    const responsePromise = waitForMutation(page, `/api/admin/models/${modelId}/fields`, "POST");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ fieldKey: "title", position: 0, type: "text" });
    const body = await readJson<FieldResponse>(response);
    await expect(page.locator("tbody").getByText("Title", { exact: true })).toBeVisible();
    return body.id;
  });

  const entryId = await test.step("create a localized draft entry from the Admin UI", async () => {
    await page.goto(`${origin}/admin/contents/${modelId}/create`);
    await expect(page.locator("#Title")).toBeVisible();
    await page.locator("#Title").fill(entryTitle);
    const responsePromise = waitForMutation(page, `/api/admin/models/${modelId}/entries`, "POST");
    await page.getByRole("button", { name: "Save Draft", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({
      status: "draft",
      fields: [{ fieldId, locale: "en", value: entryTitle }],
    });
    const id = (await readJson<EntryResponse>(response)).item.id;
    const exported = await readJson<{ entries: Array<{ id: string; status: string; draftFields?: Array<{ valueString: string }> }> }>(
      await adminRequest(page, "/api/admin/export/content"),
    );
    expect(exported.entries.find((item) => item.id === id)).toMatchObject({
      status: "draft",
      draftFields: [expect.objectContaining({ valueString: entryTitle })],
    });
    return id;
  });

  await test.step("guard unsaved desktop navigation with both decisions", async () => {
    await page.goto(`${origin}/admin/contents/${modelId}/${entryId}`);
    await expect(page.locator("#draft-Title")).toHaveValue(entryTitle);
    await page.locator("#draft-Title").fill("Unsaved desktop value");
    expect(await navigateWithUnsavedDecision(page, false)).toContain("Discard unsaved changes to these entries?");
    await expect(page).toHaveURL(new RegExp(`/admin/contents/${modelId}/${entryId}$`, "u"));
    expect(await navigateWithUnsavedDecision(page, true)).toContain("Discard unsaved changes to these entries?");
    await expect(page).toHaveURL(/\/admin\/models$/u);
  });

  await test.step("publish the draft through the confirmation dialog", async () => {
    await page.goto(`${origin}/admin/contents/${modelId}/${entryId}`);
    const responsePromise = waitForMutation(page, `/api/admin/models/${modelId}/entries/${entryId}`, "PUT");
    await page.getByRole("button", { name: "Publish", exact: true }).first().click();
    const confirmation = page.getByRole("dialog", { name: "Publish entry?" });
    await confirmation.getByRole("button", { name: "Publish", exact: true }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.locator(".status-chip.published")).toContainText("Published");
  });

  await test.step("keep a newer draft alongside the published entry", async () => {
    const response = await page.request.put(`/api/admin/models/${modelId}/entries/${entryId}`, {
      headers: { Authorization: `Bearer ${await getAdminAccessToken(page.request)}`, "Idempotency-Key": crypto.randomUUID() },
      data: { status: "draft", fields: [{ fieldId, locale: "en", value: "New unpublished text" }] },
    });
    await readJson(response);
  });

  await test.step("create an API key in the UI and read the published Contents API", async () => {
    await page.goto(`${origin}/admin/settings/api-keys`);
    await page.getByRole("button", { name: "Create New", exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Create API Key" });
    await dialog.locator("#key-name").fill("Release smoke read key");
    await dialog.getByText("contents:read", { exact: true }).click();
    await expect(dialog.locator("#perm-read")).toBeChecked();
    const responsePromise = waitForMutation(page, "/api/admin/api-keys", "POST");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const body = await readJson<{ secret: string }>(response);
    await expect(page.getByRole("dialog").filter({ hasText: "API Key Secret" }).locator("code")).toHaveText(body.secret);

    const published = await page.request.get(`/api/contents/models/${modelId}/entries`, {
      headers: { Authorization: `Bearer ${body.secret}` },
    });
    expect(published.status()).toBe(200);
    expect(await published.json()).toMatchObject({ items: [expect.objectContaining({ id: entryId })] });

    const forbiddenPreview = await page.request.get(`/api/contents/models/${modelId}/entries?draft=true`, {
      headers: { Authorization: `Bearer ${body.secret}` },
    });
    expect(forbiddenPreview.status()).toBe(403);

    const previewKeyResponse = await adminRequest(page, "/api/admin/api-keys", {
      method: "POST",
      data: {
        name: "Release smoke preview key",
        permissions: ["contents:read", "contents:preview"],
        allowedModels: [modelId],
      },
    });
    const previewSecret = (await readJson<{ secret: string }>(previewKeyResponse)).secret;
    const preview = await page.request.get(`/api/contents/models/${modelId}/entries?draft=true`, {
      headers: { Authorization: `Bearer ${previewSecret}` },
    });
    expect(preview.status()).toBe(200);
    expect(await preview.json()).toMatchObject({ items: [expect.objectContaining({ id: entryId })] });
  });

  await test.step("accept a restricted invite and enforce a 403 boundary", async () => {
    const roleResponse = await adminRequest(page, "/api/admin/roles", {
      method: "POST",
      data: {
        name: "Release Smoke Reader",
        description: "Restricted E2E role",
        permissions: { allow: ["entries:*:read"] },
      },
    });
    const roleId = (await readJson<{ role: { id: string } }>(roleResponse)).role.id;
    expect(roleId).not.toBe("");

    await page.goto(`${origin}/admin/settings/users`);
    await page.getByTestId("invite-user-button").first().click();
    const inviteDialog = page.getByRole("dialog").filter({ hasText: "Invite via token" });
    await inviteDialog.locator("#invite-email").fill("restricted-release@example.test");
    await inviteDialog
      .locator(".el-select__wrapper")
      .filter({ has: page.locator("#invite-role") })
      .click();
    await page.getByRole("option", { name: "Release Smoke Reader", exact: true }).click();
    const inviteResponsePromise = waitForMutation(page, "/api/admin/auth/invites", "POST");
    await inviteDialog.getByRole("button", { name: "Generate token", exact: true }).click();
    const inviteBody = await readJson<{ token: string }>(await inviteResponsePromise);

    const inviteContext = await browser.newContext({ baseURL: origin });
    try {
      const invitePage = await inviteContext.newPage();
      await invitePage.goto(`/admin/auth/invite?token=${encodeURIComponent(inviteBody.token)}`);
      await invitePage.locator("#invite-name").fill("Restricted Release User");
      await invitePage.locator("#invite-password").fill("ReleaseInvite1234!");
      await invitePage.locator("#invite-password-confirm").fill("ReleaseInvite1234!");
      const acceptResponsePromise = invitePage.waitForResponse(
        (response) => response.url().endsWith("/api/admin/auth/accept-invite") && response.request().method() === "POST",
      );
      await invitePage.getByRole("button", { name: "Create account", exact: true }).click();
      const acceptBody = await readJson<{ accessToken: string }>(await acceptResponsePromise);
      await expect(invitePage).toHaveURL(/\/admin\/$/u);
      const forbidden = await inviteContext.request.post("/api/admin/models", {
        headers: { Authorization: `Bearer ${acceptBody.accessToken}` },
        data: { name: "Forbidden Model", isPublic: true },
      });
      expect(forbidden.status()).toBe(403);
      for (const path of ["/api/admin/export/content", "/api/admin/export/logs"]) {
        const deniedExport = await inviteContext.request.get(path, {
          headers: { Authorization: `Bearer ${acceptBody.accessToken}` },
        });
        expect(deniedExport.status()).toBe(403);
      }
    } finally {
      await inviteContext.close();
    }
  });

  const mediaId = await test.step("upload a valid PDF and reject spoofed PNG bytes without mutation", async () => {
    const before = await readJson<{ items: unknown[] }>(await adminRequest(page, "/api/admin/media"));
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n", "utf8");
    await page.goto(`${origin}/admin/media`);
    await page.getByRole("button", { name: "Upload Files", exact: true }).click();
    const uploadDialog = page.getByRole("dialog", { name: "Upload Files" });
    await uploadDialog.locator('input[type="file"]').setInputFiles({
      name: "release-smoke.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    const uploadResponsePromise = waitForMutation(page, "/api/admin/media", "POST");
    await page.getByRole("button", { name: "Start upload", exact: true }).click();
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(201);
    const uploadBody = await readJson<MediaResponse>(uploadResponse);
    expect(uploadBody.items[0]).toMatchObject({ mimeType: "application/pdf", size: pdf.byteLength });
    await expect(page.getByRole("heading", { name: "release-smoke.pdf", exact: true })).toBeVisible();

    const invalid = await adminRequest(page, "/api/admin/media", {
      method: "POST",
      multipart: {
        "files[]": { name: "spoofed.png", mimeType: "image/png", buffer: Buffer.from("not-a-png", "utf8") },
      },
    });
    expect(invalid.status()).toBe(415);
    expect(await invalid.json()).toMatchObject({ error: { code: "MEDIA_TYPE_MISMATCH" } });
    const after = await readJson<{ items: unknown[] }>(await adminRequest(page, "/api/admin/media"));
    expect(after.items).toHaveLength(before.items.length + 1);
    return uploadBody.items[0]?.id ?? "";
  });

  expect(mediaId).not.toBe("");

  await test.step("export current content and separate stored logs", async () => {
    const content = await adminRequest(page, "/api/admin/export/content");
    expect(content.status()).toBe(200);
    expect(content.headers()["content-disposition"]).toContain("attachment");
    expect(await content.json()).toMatchObject({
      format: "nabecms-content-export",
      version: 1,
      counts: { models: 1, fields: 1, entries: 1, media: 1 },
      models: [expect.objectContaining({ id: modelId, fields: [expect.objectContaining({ id: fieldId })] })],
      entries: [
        expect.objectContaining({
          id: entryId,
          status: "published",
          publishedFields: [expect.objectContaining({ valueString: entryTitle })],
          draftFields: [expect.objectContaining({ valueString: "New unpublished text" })],
        }),
      ],
      media: [expect.objectContaining({ id: mediaId, downloadPath: `/api/admin/media/${mediaId}/file` })],
    });
    const logs = await adminRequest(page, "/api/admin/export/logs");
    expect(logs.status()).toBe(200);
    expect(await logs.json()).toMatchObject({
      format: "nabecms-log-export",
      version: 1,
      counts: { auditLogs: expect.any(Number), authLoginEvents: expect.any(Number) },
      auditLogs: expect.any(Array),
      authLoginEvents: expect.any(Array),
    });
    await page.goto(`${origin}/admin/settings`);
    await expect(page.getByRole("button", { name: "Open export" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "../../output/playwright/settings-general-export.png", fullPage: true });
    await page.getByRole("button", { name: "Open export" }).click();
    await expect(page).toHaveURL(`${origin}/admin/settings/export`);
    await expect(page.getByRole("heading", { name: "Export data" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download content JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download logs JSON" })).toBeVisible();
    await page.screenshot({ path: "../../output/playwright/export-page.png", fullPage: true });
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download content JSON" }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/^nabecms-content-.*\.json$/u);
  });

  await test.step("export the latest content of an archived entry", async () => {
    const created = await page.request.post(`/api/admin/models/${modelId}/entries`, {
      headers: { Authorization: `Bearer ${await getAdminAccessToken(page.request)}`, "Idempotency-Key": crypto.randomUUID() },
      data: { status: "archived", fields: [{ fieldId, locale: "en", value: "Archived content" }] },
    });
    const archivedId = (await readJson<EntryResponse>(created)).item.id;
    const exported = await readJson<{ entries: Array<{ id: string; status: string; archivedFields?: Array<{ valueString: string }> }> }>(
      await adminRequest(page, "/api/admin/export/content"),
    );
    expect(exported.entries.find((entry) => entry.id === archivedId)).toMatchObject({
      status: "archived",
      archivedFields: [expect.objectContaining({ valueString: "Archived content" })],
    });
  });

  expect(await getAdminAccessToken(page.request)).not.toBe("");
  await writeReleaseState({ modelId, entryId, mediaId });
});

test("persists rich text formatting through the real editor and Worker", async ({ page }) => {
  const origin = getWorkerOrigin();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${origin}/admin/models`);

  const model = await readJson<ModelResponse>(
    await adminRequest(page, "/api/admin/models", {
      method: "POST",
      data: { name: "Rich Text Dependency Smoke", description: "Real editor persistence", isPublic: true },
    }),
  );
  await readJson<FieldResponse>(
    await adminRequest(page, `/api/admin/models/${model.item.id}/fields`, {
      method: "POST",
      data: { name: "Title", fieldKey: "title", type: "text", variant: "shortText", position: 0, hasLocales: false, required: false },
    }),
  );
  const body = await readJson<FieldResponse>(
    await adminRequest(page, `/api/admin/models/${model.item.id}/fields`, {
      method: "POST",
      data: { name: "Body", fieldKey: "body", type: "rich_text", position: 1, hasLocales: false, required: false },
    }),
  );

  await page.goto(`${origin}/admin/contents/${model.item.id}/create`);
  await page.locator("#Title").fill("Rich text persistence");
  // The entry page also mounts a read-only preview; inspect the editable instance.
  const editorHost = page.locator(".rt-editor").filter({ has: page.locator('.tiptap[contenteditable="true"]') });
  const editor = editorHost.locator('.tiptap[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  const text = "Formatted dependency smoke";
  await editor.pressSequentially(text);
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "太字", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText(text);

  const href = "https://example.com/editor-smoke";
  page.once("dialog", (dialog) => dialog.accept(href));
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  await expect(editor.locator("a")).toHaveAttribute("href", href);
  await expect(editorHost.locator(".rt-drag-handle")).toHaveCount(1);

  const saved = waitForMutation(page, `/api/admin/models/${model.item.id}/entries`, "POST");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const submitted = response.request().postDataJSON() as { fields: Array<{ fieldId: string; value: unknown }> };
  expect(submitted.fields.find((field) => field.fieldId === body.id)?.value).toMatchObject({
    type: "rich_text",
    value: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text,
              marks: expect.arrayContaining([{ type: "bold" }, { type: "link", attrs: expect.objectContaining({ href }) }]),
            },
          ],
        },
      ],
    },
  });
  const entry = await readJson<EntryResponse>(response);
  await page.goto(`${origin}/admin/contents/${model.item.id}/${entry.item.id}`);
  await expect(editor.locator("strong")).toHaveText(text);
  await expect(editor.locator("a")).toHaveAttribute("href", href);
  await expect(editorHost.locator(".rt-drag-handle")).toHaveCount(1);
  expect(pageErrors).toEqual([]);
});
