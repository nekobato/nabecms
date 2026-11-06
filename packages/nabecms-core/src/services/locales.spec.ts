import { describe, it, expect, beforeEach } from "vitest";
import {
  createLocale,
  deleteLocale,
  listLocales,
  setDefaultLocale,
  LocaleAlreadyExistsError,
  LocaleNotFoundError,
  CannotDeleteDefaultLocaleError,
  type LocalesServiceDeps,
} from "./locales";
import type { LocaleRepository, LocaleRecord } from "../repositories/locales";

class MockLocaleRepository implements LocaleRepository {
  private records: LocaleRecord[] = [];

  constructor(initial: LocaleRecord[] = []) {
    this.records = [...initial];
  }

  list(): Promise<LocaleRecord[]> {
    const sorted = [...this.records].sort((a, b) => {
      if (a.isDefault === b.isDefault) {
        return a.code.localeCompare(b.code);
      }
      return a.isDefault ? -1 : 1;
    });
    return Promise.resolve(sorted);
  }

  findByCode(code: string): Promise<LocaleRecord | null> {
    return Promise.resolve(
      this.records.find((record) => record.code === code) ?? null,
    );
  }

  getDefault(): Promise<LocaleRecord | null> {
    return Promise.resolve(
      this.records.find((record) => record.isDefault) ?? null,
    );
  }

  async insert(record: LocaleRecord): Promise<void> {
    this.records.push(record);
  }

  async clearDefault(updatedAt: string): Promise<void> {
    this.records = this.records.map((record) =>
      record.isDefault ? { ...record, isDefault: false, updatedAt } : record,
    );
  }

  async updateByCode(
    code: string,
    values: Partial<Pick<LocaleRecord, "isDefault" | "updatedAt">>,
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.code === code ? { ...record, ...values } : record,
    );
  }

  async deleteByCode(code: string): Promise<void> {
    this.records = this.records.filter((record) => record.code !== code);
  }
}

describe("locales service", () => {
  let repo: MockLocaleRepository;
  let deps: LocalesServiceDeps;

  beforeEach(() => {
    repo = new MockLocaleRepository([
      {
        code: "en-US",
        isDefault: true,
        createdAt: "2025-09-01T00:00:00.000Z",
        updatedAt: "2025-09-01T00:00:00.000Z",
      },
    ]);
    deps = {
      repo,
      now: () => new Date("2025-09-30T12:00:00.000Z"),
    };
  });

  it("lists locales", async () => {
    const items = await listLocales(deps);
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe("en-US");
  });

  it("creates a locale", async () => {
    const created = await createLocale(deps, {
      code: "ja-JP",
      isDefault: false,
    });
    expect(created.code).toBe("ja-JP");
    const items = await listLocales(deps);
    expect(items).toHaveLength(2);
  });

  it("sets first locale as default when none exists", async () => {
    repo = new MockLocaleRepository();
    deps = { repo, now: () => new Date("2025-09-30T12:00:00.000Z") };
    const created = await createLocale(deps, { code: "de" });
    expect(created.isDefault).toBe(true);
  });

  it("clears previous default when creating a new default locale", async () => {
    const created = await createLocale(deps, {
      code: "ja-JP",
      isDefault: true,
    });
    expect(created.isDefault).toBe(true);
    const defaults = (await listLocales(deps)).filter(
      (locale) => locale.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe("ja-JP");
  });

  it("throws when creating duplicate locale", async () => {
    await expect(createLocale(deps, { code: "en-US" })).rejects.toBeInstanceOf(
      LocaleAlreadyExistsError,
    );
  });

  it("sets locale as default", async () => {
    await createLocale(deps, { code: "ja-JP" });
    const updated = await setDefaultLocale(deps, "ja-JP");
    expect(updated.isDefault).toBe(true);
    const defaults = (await listLocales(deps)).filter(
      (locale) => locale.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect(defaults[0].code).toBe("ja-JP");
  });

  it("throws when setting default for non-existent locale", async () => {
    await expect(setDefaultLocale(deps, "unknown")).rejects.toBeInstanceOf(
      LocaleNotFoundError,
    );
  });

  it("deletes locale", async () => {
    await createLocale(deps, { code: "ja-JP" });
    await deleteLocale(deps, "ja-JP");
    const items = await listLocales(deps);
    expect(items.some((locale) => locale.code === "ja-JP")).toBe(false);
  });

  it("prevents deleting default locale", async () => {
    await expect(deleteLocale(deps, "en-US")).rejects.toBeInstanceOf(
      CannotDeleteDefaultLocaleError,
    );
  });
});
