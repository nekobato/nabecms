import { describe, it, expect, vi } from "vitest";
import {
  getMediaSettings,
  updateMediaSettings,
  defaultMediaSettings,
  MediaSettingsValidationError,
  resolveCloudflareFit,
} from "./media-settings";

const createRepo = () => ({
  findByKey: vi.fn(),
  upsert: vi.fn(),
});

describe("media settings service", () => {
  it("returns default settings when missing", async () => {
    const repo = createRepo();
    repo.findByKey.mockResolvedValue(null);

    const result = await getMediaSettings({ repo });

    expect(result).toEqual(defaultMediaSettings);
  });

  it("fills optional config when stored value is partial", async () => {
    const repo = createRepo();
    repo.findByKey.mockResolvedValue({
      key: "media_settings",
      value: { transformMode: "cloudflare", templates: [] },
      updatedAt: "2025-12-01T00:00:00.000Z",
    });

    const result = await getMediaSettings({ repo });

    expect(result.transformMode).toBe("cloudflare");
    expect(result.cloudflare).toEqual({ enabled: false });
  });

  it("updates settings with normalized templates", async () => {
    const repo = createRepo();
    repo.findByKey.mockResolvedValue(null);

    const result = await updateMediaSettings(
      { repo, now: () => new Date("2025-12-01T00:00:00.000Z") },
      {
        transformMode: "frontend",
        templates: [
          {
            key: " thumb ",
            label: "Thumbnail",
            width: 320,
            fit: "cover",
            format: "webp",
            quality: 80,
          },
        ],
        cloudflare: { enabled: false },
      },
    );

    expect(result.templates[0]?.key).toBe("thumb");
    expect(repo.upsert).toHaveBeenCalledWith(
      "media_settings",
      expect.objectContaining({
        transformMode: "frontend",
        templates: [
          expect.objectContaining({ key: "thumb", width: 320, format: "webp" }),
        ],
      }),
      expect.any(String),
    );
  });

  it("normalizes legacy fit values from stored settings", async () => {
    const repo = createRepo();
    repo.findByKey.mockResolvedValue({
      key: "media_settings",
      value: {
        transformMode: "cloudflare",
        templates: [
          { key: "legacy-fill", width: 640, height: 360, fit: "fill" },
          {
            key: "legacy-scale-down",
            width: 320,
            height: 180,
            fit: "scale-down",
            upscale: true,
          },
        ],
      },
      updatedAt: "2025-12-01T00:00:00.000Z",
    });

    const result = await getMediaSettings({ repo });

    expect(result.templates[0]?.fit).toBe("cover");
    expect(result.templates[1]?.fit).toBe("contain");
    expect(result.templates[1]?.upscale).toBe(false);
  });

  it("maps fit and upscale to Cloudflare fit options", () => {
    expect(
      resolveCloudflareFit({
        key: "contain-upscale-on",
        width: 800,
        height: 600,
        fit: "contain",
        upscale: true,
      }),
    ).toBe("contain");

    expect(
      resolveCloudflareFit({
        key: "contain-upscale-off",
        width: 800,
        height: 600,
        fit: "contain",
        upscale: false,
      }),
    ).toBe("scale-down");

    expect(
      resolveCloudflareFit({
        key: "cover-upscale-on",
        width: 800,
        height: 600,
        fit: "cover",
        upscale: true,
      }),
    ).toBe("cover");

    expect(
      resolveCloudflareFit({
        key: "cover-upscale-off",
        width: 800,
        height: 600,
        fit: "cover",
        upscale: false,
      }),
    ).toBe("crop");

    expect(
      resolveCloudflareFit({
        key: "single-axis-no-upscale",
        width: 800,
        fit: "cover",
        upscale: false,
      }),
    ).toBe("scale-down");
  });

  it("rejects templates without width/height", async () => {
    const repo = createRepo();
    repo.findByKey.mockResolvedValue(null);

    await expect(
      updateMediaSettings(
        { repo, now: () => new Date() },
        {
          transformMode: "frontend",
          templates: [
            {
              key: "broken",
              label: "Broken",
            },
          ],
          cloudflare: { enabled: false },
        },
      ),
    ).rejects.toBeInstanceOf(MediaSettingsValidationError);
  });
});
