import { describe, it, expect, beforeEach } from "vitest";
import type {
  ContentsRepository,
  ContentEntry,
  ListEntriesParams,
} from "./contents-delivery";
import {
  listContentEntries,
  listContentModels,
  getContentEntry,
  InvalidFilterError,
} from "./contents-delivery";

type ModelFieldRecord = {
  id: string;
  modelId: string;
  name: string;
  fieldKey: string;
  type:
    | "text"
    | "rich_text"
    | "number"
    | "date"
    | "list"
    | "media"
    | "json"
    | "relation"
    | "boolean"
    | "custom";
  hasLocales: boolean;
  isPrivate: boolean;
  variant?: string | null;
  options?: unknown;
};

type EntryRecord = {
  id: string;
  modelId: string;
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

type EntryFieldRecord = {
  entryId: string;
  fieldId: string;
  fieldKey: string;
  type: ModelFieldRecord["type"];
  variant?: string | null;
  hasLocales: boolean;
  isPrivate: boolean;
  locale: string;
  valueString: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: unknown;
  valueMedia: string | null;
  valueRelation: unknown;
};

type MediaRecord = {
  id: string;
  url: string;
  mimeType: string;
  type: string;
  width: number | null;
  height: number | null;
  size: number;
  description: string | null;
};

type ModelRecord = {
  id: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  fields: ModelFieldRecord[];
};

type ApiKeyRecord = {
  id: string;
  key: string;
  permissions: string[];
  allowedModels: string[] | null;
  isRevoked: boolean;
  keyHash?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

class StubContentsRepository implements ContentsRepository {
  constructor(
    private readonly data: {
      models: ModelRecord[];
      entries: EntryRecord[];
      entryFields: EntryFieldRecord[];
      media: MediaRecord[];
      apiKeys?: ApiKeyRecord[];
      defaultLocale?: string;
    },
  ) {}

  async findApiKeyByKey(key: string) {
    return (this.data.apiKeys ?? []).find((item) => item.key === key) ?? null;
  }

  async findApiKeyByToken(tokenHash: string, tokenPlain: string) {
    const match = (this.data.apiKeys ?? []).find(
      (item) => item.key === tokenHash || item.key === tokenPlain,
    );
    if (!match) return null;
    return {
      ...match,
      allowedModels: match.allowedModels ?? null,
      isRevoked: match.isRevoked ?? false,
    };
  }

  async findDefaultLocale() {
    return this.data.defaultLocale ?? "en-US";
  }

  async listPublicModels() {
    return this.data.models.filter((model) => !model.isPrivate);
  }

  async findModelById(id: string) {
    return this.data.models.find((model) => model.id === id) ?? null;
  }

  async listEntriesByModel(
    modelId: string,
    options: { statuses: string[]; since?: string | null },
  ) {
    const pool = this.data.entries.filter(
      (entry) =>
        entry.modelId === modelId && options.statuses.includes(entry.status),
    );
    if (options.since) {
      return pool.filter((entry) => entry.updatedAt >= options.since!);
    }
    return pool;
  }

  async listEntriesByIds(ids: string[], options: { statuses: string[] }) {
    return this.data.entries.filter(
      (entry) =>
        ids.includes(entry.id) && options.statuses.includes(entry.status),
    );
  }

  async findEntryById(modelId: string, entryId: string) {
    return (
      this.data.entries.find(
        (entry) => entry.id === entryId && entry.modelId === modelId,
      ) ?? null
    );
  }

  async listEntryFields(
    entryIds: string[],
    options: { fieldKeys?: string[]; locales?: string[] },
  ) {
    const localeSet = new Set(options.locales ?? []);
    const fieldSet = options.fieldKeys ? new Set(options.fieldKeys) : null;
    return this.data.entryFields.filter((field) => {
      if (!entryIds.includes(field.entryId)) return false;
      if (fieldSet && !fieldSet.has(field.fieldKey)) return false;
      if (localeSet.size > 0 && !localeSet.has(field.locale)) return false;
      return !field.isPrivate;
    });
  }

  async listMediaByIds(ids: string[]) {
    return this.data.media.filter((item) => ids.includes(item.id));
  }
}

const baseModels: ModelRecord[] = [
  {
    id: "blog",
    name: "Blog",
    description: "",
    isPrivate: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    fields: [
      {
        id: "field_slug",
        modelId: "blog",
        name: "Slug",
        fieldKey: "slug",
        type: "text",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_title",
        modelId: "blog",
        name: "Title",
        fieldKey: "title",
        type: "text",
        hasLocales: true,
        isPrivate: false,
      },
      {
        id: "field_rating",
        modelId: "blog",
        name: "Rating",
        fieldKey: "rating",
        type: "number",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_publish_date",
        modelId: "blog",
        name: "Publish Date",
        fieldKey: "publish_date",
        type: "date",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_featured",
        modelId: "blog",
        name: "Featured",
        fieldKey: "featured",
        type: "boolean",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_body",
        modelId: "blog",
        name: "Body",
        fieldKey: "body",
        type: "rich_text",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_hero",
        modelId: "blog",
        name: "Hero",
        fieldKey: "hero",
        type: "media",
        hasLocales: false,
        isPrivate: false,
        variant: "single",
      },
      {
        id: "field_gallery",
        modelId: "blog",
        name: "Gallery",
        fieldKey: "gallery",
        type: "media",
        hasLocales: false,
        isPrivate: false,
        variant: "multiple",
      },
      {
        id: "field_secret",
        modelId: "blog",
        name: "Secret",
        fieldKey: "secret",
        type: "text",
        hasLocales: false,
        isPrivate: true,
      },
      {
        id: "field_author",
        modelId: "blog",
        name: "Author",
        fieldKey: "author",
        type: "relation",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_metadata",
        modelId: "blog",
        name: "Metadata",
        fieldKey: "metadata",
        type: "json",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "field_tags",
        modelId: "blog",
        name: "Tags",
        fieldKey: "tags",
        type: "list",
        hasLocales: false,
        isPrivate: false,
        options: { item: { type: "text" } },
      },
      {
        id: "field_scores",
        modelId: "blog",
        name: "Scores",
        fieldKey: "scores",
        type: "list",
        hasLocales: false,
        isPrivate: false,
        options: { item: { type: "number" } },
      },
      {
        id: "field_dates",
        modelId: "blog",
        name: "Dates",
        fieldKey: "dates",
        type: "list",
        hasLocales: false,
        isPrivate: false,
        options: { item: { type: "date" } },
      },
      {
        id: "field_flags",
        modelId: "blog",
        name: "Flags",
        fieldKey: "flags",
        type: "list",
        hasLocales: false,
        isPrivate: false,
        options: { item: { type: "boolean" } },
      },
    ],
  },
  {
    id: "author",
    name: "Author",
    description: "",
    isPrivate: false,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-02T00:00:00Z",
    fields: [
      {
        id: "author_slug",
        modelId: "author",
        name: "Slug",
        fieldKey: "slug",
        type: "text",
        hasLocales: false,
        isPrivate: false,
      },
      {
        id: "author_name",
        modelId: "author",
        name: "Name",
        fieldKey: "name",
        type: "text",
        hasLocales: true,
        isPrivate: false,
      },
      {
        id: "author_avatar",
        modelId: "author",
        name: "Avatar",
        fieldKey: "avatar",
        type: "media",
        hasLocales: false,
        isPrivate: false,
        variant: "single",
      },
    ],
  },
];

const baseEntries: EntryRecord[] = [
  {
    id: "entry_pub",
    modelId: "blog",
    status: "published",
    createdAt: "2025-03-01T00:00:00Z",
    updatedAt: "2025-03-02T00:00:00Z",
    publishedAt: "2025-03-01T02:10:00Z",
  },
  {
    id: "entry_draft",
    modelId: "blog",
    status: "draft",
    createdAt: "2025-04-01T00:00:00Z",
    updatedAt: "2025-04-02T00:00:00Z",
    publishedAt: null,
  },
  {
    id: "author_1",
    modelId: "author",
    status: "published",
    createdAt: "2025-02-01T00:00:00Z",
    updatedAt: "2025-03-03T00:00:00Z",
    publishedAt: "2025-02-01T02:10:00Z",
  },
];

const baseEntryFields: EntryFieldRecord[] = [
  {
    entryId: "entry_pub",
    fieldId: "field_slug",
    fieldKey: "slug",
    type: "text",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: "cafe-guide",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_title",
    fieldKey: "title",
    type: "text",
    hasLocales: true,
    isPrivate: false,
    locale: "en-US",
    valueString: "Cafe Guide",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_title",
    fieldKey: "title",
    type: "text",
    hasLocales: true,
    isPrivate: false,
    locale: "ja-JP",
    valueString: "カフェ案内",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_hero",
    fieldKey: "hero",
    type: "media",
    variant: "single",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: "media_1",
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_gallery",
    fieldKey: "gallery",
    type: "media",
    variant: "multiple",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: ["media_1", "media_2"],
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_rating",
    fieldKey: "rating",
    type: "number",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: 4.5,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_publish_date",
    fieldKey: "publish_date",
    type: "date",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: "2025-03-01",
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_featured",
    fieldKey: "featured",
    type: "boolean",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: true,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_author",
    fieldKey: "author",
    type: "relation",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: { type: "one", entryIds: ["author_1"] },
  },
  {
    entryId: "entry_pub",
    fieldId: "field_metadata",
    fieldKey: "metadata",
    type: "json",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: { category: "coffee" },
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_tags",
    fieldKey: "tags",
    type: "list",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: ["coffee", "guide"],
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_scores",
    fieldKey: "scores",
    type: "list",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: [4, 5],
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_dates",
    fieldKey: "dates",
    type: "list",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: ["2026-03-10"],
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_pub",
    fieldId: "field_flags",
    fieldKey: "flags",
    type: "list",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: [true, false],
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "entry_draft",
    fieldId: "field_slug",
    fieldKey: "slug",
    type: "text",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: "draft-post",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "author_1",
    fieldId: "author_slug",
    fieldKey: "slug",
    type: "text",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: "alice-smith",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "author_1",
    fieldId: "author_name",
    fieldKey: "name",
    type: "text",
    hasLocales: true,
    isPrivate: false,
    locale: "en-US",
    valueString: "Alice Smith",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "author_1",
    fieldId: "author_name",
    fieldKey: "name",
    type: "text",
    hasLocales: true,
    isPrivate: false,
    locale: "ja-JP",
    valueString: "アリス・スミス",
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  },
  {
    entryId: "author_1",
    fieldId: "author_avatar",
    fieldKey: "avatar",
    type: "media",
    variant: "single",
    hasLocales: false,
    isPrivate: false,
    locale: "en-US",
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: null,
    valueMedia: "media_2",
    valueRelation: null,
  },
];

const baseMedia: MediaRecord[] = [
  {
    id: "media_1",
    url: "https://r2.example/cafe.jpg",
    mimeType: "image/jpeg",
    type: "image",
    width: 1600,
    height: 900,
    size: 482133,
    description: "Cafe hero",
  },
  {
    id: "media_2",
    url: "https://r2.example/alice.jpg",
    mimeType: "image/jpeg",
    type: "image",
    width: 800,
    height: 800,
    size: 182133,
    description: "Author avatar",
  },
];

const buildRepo = (
  overrides: Partial<
    ConstructorParameters<typeof StubContentsRepository>[0]
  > = {},
) =>
  new StubContentsRepository({
    models: baseModels,
    entries: baseEntries,
    entryFields: baseEntryFields,
    media: baseMedia,
    apiKeys: [
      {
        id: "key_1",
        key: "secret",
        permissions: ["contents:read", "contents:preview"],
        allowedModels: null,
        isRevoked: false,
        keyHash: null,
        lastUsedAt: null,
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
      },
    ],
    defaultLocale: "en-US",
    ...overrides,
  });

const buildRichTextBodyField = (
  entryId: string,
  referenceIds: readonly string[],
): EntryFieldRecord => ({
  entryId,
  fieldId: "field_body",
  fieldKey: "body",
  type: "rich_text",
  hasLocales: false,
  isPrivate: false,
  locale: "en-US",
  valueString: null,
  valueNumber: null,
  valueDate: null,
  valueBoolean: null,
  valueJson: {
    type: "rich_text",
    value: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        ...referenceIds.map((referenceId) => ({
          type: "entryReference",
          attrs: { entryId: referenceId },
        })),
        {
          type: "paragraph",
          content: [{ type: "text", text: "After" }],
        },
      ],
    },
  },
  valueMedia: null,
  valueRelation: null,
});

const extractRichTextEntryReferenceIds = (value: unknown): string[] => {
  let root = value;
  if (typeof value === "string") {
    try {
      root = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!root || typeof root !== "object") return [];
  const envelope = root as { value?: unknown };
  if (!envelope.value || typeof envelope.value !== "object") return [];
  const doc = envelope.value as { content?: unknown };
  if (!Array.isArray(doc.content)) return [];

  const result: string[] = [];
  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const richNode = node as { type?: unknown; attrs?: unknown };
    if (richNode.type !== "entryReference") continue;
    if (!richNode.attrs || typeof richNode.attrs !== "object") continue;
    const entryId = (richNode.attrs as { entryId?: unknown }).entryId;
    if (typeof entryId === "string") {
      result.push(entryId);
    }
  }
  return result;
};

describe("contents-delivery service", () => {
  let repo: StubContentsRepository;

  beforeEach(() => {
    repo = buildRepo();
  });

  it("lists public models without private fields", async () => {
    const result = await listContentModels({ repo });
    expect(result.items).toHaveLength(2);
    const blogModel = result.items.find((model) => model.id === "blog");
    expect(blogModel?.fields.some((field) => field.fieldKey === "secret")).toBe(
      false,
    );
  });

  it("returns published entries with locale preference and media side-loaded assets", async () => {
    const params: ListEntriesParams = {
      modelId: "blog",
      locales: ["ja-JP"],
      includeDraft: false,
      includeMedia: true,
      includeRelations: true,
      page: 1,
      limit: 10,
    };

    const result = await listContentEntries({ repo }, params);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.fields.slug).toBe("cafe-guide");
    expect(item.fields.title).toBe("カフェ案内");
    expect(item.fields.hero).toBe("media_1");
    expect(item.fields.gallery).toEqual(["media_1", "media_2"]);
    expect(item.fields.tags).toEqual(["coffee", "guide"]);
    expect(item.fields.scores).toEqual([4, 5]);
    expect(item.fields.dates).toEqual(["2026-03-10"]);
    expect(item.fields.flags).toEqual([true, false]);
    expect(item.relations?.author).toEqual({
      type: "one",
      entryIds: ["author_1"],
    });
    expect(result.included.entries).toEqual([
      expect.objectContaining({
        id: "author_1",
        modelId: "author",
        locale: "ja-JP",
        fields: expect.objectContaining({
          name: "アリス・スミス",
          avatar: "media_2",
        }),
      }),
    ]);
    expect(result.included.assets.map((asset) => asset.id)).toEqual([
      "media_1",
      "media_2",
    ]);
    expect(result.errors).toEqual([]);
  });

  it("resolves media URLs via createPublicMediaUrl when provided", async () => {
    const repoWithKeys = buildRepo({
      media: [
        {
          id: "media_1",
          url: "media/ja/file.jpg",
          mimeType: "image/jpeg",
          type: "image",
          width: 800,
          height: 600,
          size: 1000,
          description: "desc",
        },
        {
          id: "media_2",
          url: "media/ja/avatar.jpg",
          mimeType: "image/jpeg",
          type: "image",
          width: 320,
          height: 320,
          size: 900,
          description: "avatar",
        },
      ],
    });

    const result = await listContentEntries(
      {
        repo: repoWithKeys,
        createPublicMediaUrl: ({ key }) => `https://cdn.example.com/${key}`,
      },
      { modelId: "blog" },
    );

    expect(result.items[0]?.fields.hero).toBe("media_1");
    expect(result.included.assets[0]?.url).toBe(
      "https://cdn.example.com/media/ja/file.jpg",
    );
  });

  it("returns media references even when media side-load is disabled", async () => {
    const result = await listContentEntries(
      { repo },
      { modelId: "blog", includeMedia: false, includeRelations: false },
    );

    const item = result.items[0];
    expect(item.fields.hero).toBe("media_1");
    expect(item.fields.gallery).toEqual(["media_1", "media_2"]);
    expect(result.included.assets).toHaveLength(0);
    expect(item.relations).toBeUndefined();
  });

  it("includes drafts when includeDraft is true", async () => {
    const result = await listContentEntries(
      { repo },
      { modelId: "blog", includeDraft: true },
    );

    const ids = result.items.map((item: ContentEntry) => item.id);
    expect(ids).toContain("entry_pub");
    expect(ids).toContain("entry_draft");
  });

  it("removes rich text entry references that are not visible in public responses", async () => {
    const result = await listContentEntries(
      {
        repo: buildRepo({
          entries: [
            ...baseEntries,
            {
              id: "author_draft",
              modelId: "author",
              status: "draft",
              createdAt: "2025-05-01T00:00:00Z",
              updatedAt: "2025-05-02T00:00:00Z",
              publishedAt: null,
            },
          ],
          entryFields: [
            ...baseEntryFields,
            buildRichTextBodyField("entry_pub", [
              "author_1",
              "author_draft",
              "missing_author",
            ]),
          ],
        }),
      },
      { modelId: "blog" },
    );

    expect(
      extractRichTextEntryReferenceIds(result.items[0]?.fields.body),
    ).toEqual(["author_1"]);
  });

  it("removes hidden references from stringified rich text values", async () => {
    const bodyField = buildRichTextBodyField("entry_pub", [
      "author_1",
      "author_draft",
    ]);
    const result = await listContentEntries(
      {
        repo: buildRepo({
          entries: [
            ...baseEntries,
            {
              id: "author_draft",
              modelId: "author",
              status: "draft",
              createdAt: "2025-05-01T00:00:00Z",
              updatedAt: "2025-05-02T00:00:00Z",
              publishedAt: null,
            },
          ],
          entryFields: [
            ...baseEntryFields,
            { ...bodyField, valueJson: JSON.stringify(bodyField.valueJson) },
          ],
        }),
      },
      { modelId: "blog" },
    );

    expect(
      extractRichTextEntryReferenceIds(result.items[0]?.fields.body),
    ).toEqual(["author_1"]);
  });

  it("keeps draft rich text entry references in preview responses", async () => {
    const result = await listContentEntries(
      {
        repo: buildRepo({
          entries: [
            ...baseEntries,
            {
              id: "author_draft",
              modelId: "author",
              status: "draft",
              createdAt: "2025-05-01T00:00:00Z",
              updatedAt: "2025-05-02T00:00:00Z",
              publishedAt: null,
            },
          ],
          entryFields: [
            ...baseEntryFields,
            buildRichTextBodyField("entry_pub", [
              "author_1",
              "author_draft",
              "missing_author",
            ]),
          ],
        }),
      },
      { modelId: "blog", includeDraft: true },
    );

    expect(
      extractRichTextEntryReferenceIds(result.items[0]?.fields.body),
    ).toEqual(["author_1", "author_draft"]);
  });

  it("filters fields when fields param is provided", async () => {
    const result = await listContentEntries(
      { repo },
      { modelId: "blog", fields: ["slug"] },
    );

    const item = result.items[0];
    expect(item.fields.slug).toBe("cafe-guide");
    expect(item.fields.title).toBeUndefined();
    expect(item.fields.hero).toBeUndefined();
  });

  it("filters entries by text, number, date, and boolean fields", async () => {
    const result = await listContentEntries(
      {
        repo: buildRepo({
          entries: [
            ...baseEntries,
            {
              id: "entry_pub_2",
              modelId: "blog",
              status: "published",
              createdAt: "2025-03-10T00:00:00Z",
              updatedAt: "2025-03-11T00:00:00Z",
              publishedAt: "2025-03-10T02:10:00Z",
            },
          ],
          entryFields: [
            ...baseEntryFields,
            {
              entryId: "entry_pub_2",
              fieldId: "field_slug",
              fieldKey: "slug",
              type: "text",
              hasLocales: false,
              isPrivate: false,
              locale: "en-US",
              valueString: "tokyo-roastery",
              valueNumber: null,
              valueDate: null,
              valueBoolean: null,
              valueJson: null,
              valueMedia: null,
              valueRelation: null,
            },
            {
              entryId: "entry_pub_2",
              fieldId: "field_title",
              fieldKey: "title",
              type: "text",
              hasLocales: true,
              isPrivate: false,
              locale: "en-US",
              valueString: "Tokyo Roastery",
              valueNumber: null,
              valueDate: null,
              valueBoolean: null,
              valueJson: null,
              valueMedia: null,
              valueRelation: null,
            },
            {
              entryId: "entry_pub_2",
              fieldId: "field_rating",
              fieldKey: "rating",
              type: "number",
              hasLocales: false,
              isPrivate: false,
              locale: "en-US",
              valueString: null,
              valueNumber: 3.2,
              valueDate: null,
              valueBoolean: null,
              valueJson: null,
              valueMedia: null,
              valueRelation: null,
            },
            {
              entryId: "entry_pub_2",
              fieldId: "field_publish_date",
              fieldKey: "publish_date",
              type: "date",
              hasLocales: false,
              isPrivate: false,
              locale: "en-US",
              valueString: null,
              valueNumber: null,
              valueDate: "2025-03-10",
              valueBoolean: null,
              valueJson: null,
              valueMedia: null,
              valueRelation: null,
            },
            {
              entryId: "entry_pub_2",
              fieldId: "field_featured",
              fieldKey: "featured",
              type: "boolean",
              hasLocales: false,
              isPrivate: false,
              locale: "en-US",
              valueString: null,
              valueNumber: null,
              valueDate: null,
              valueBoolean: false,
              valueJson: null,
              valueMedia: null,
              valueRelation: null,
            },
          ],
        }),
      },
      {
        modelId: "blog",
        filters: {
          featured: { $eq: true },
          rating: { $gte: 4 },
          publish_date: { $lte: "2025-03-05" },
          $or: [
            { title: { $contains: "Cafe" } },
            { "fields.slug": { $eq: "cafe-guide" } },
          ],
        },
      },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("entry_pub");
  });

  it("returns unresolved relation errors without duplicating primary items", async () => {
    const repoWithBrokenRelation = buildRepo({
      entryFields: baseEntryFields.map((field) =>
        field.entryId === "entry_pub" && field.fieldKey === "author"
          ? {
              ...field,
              valueRelation: {
                type: "many",
                entryIds: ["author_1", "missing_author"],
              },
            }
          : field,
      ),
    });

    const result = await listContentEntries(
      { repo: repoWithBrokenRelation },
      { modelId: "blog", includeRelations: true, includeMedia: true },
    );

    expect(result.included.entries.map((entry) => entry.id)).toEqual([
      "author_1",
    ]);
    expect(result.errors).toEqual([
      {
        code: "UNRESOLVABLE_LINK",
        sourceEntryId: "entry_pub",
        sourceModelId: "blog",
        fieldKey: "author",
        targetEntryId: "missing_author",
      },
    ]);
  });

  it("omits unresolved media from included.assets while preserving field references", async () => {
    const result = await listContentEntries(
      {
        repo: buildRepo({
          media: baseMedia.filter((media) => media.id !== "media_2"),
        }),
      },
      { modelId: "blog", includeMedia: true, includeRelations: true },
    );

    expect(result.items[0]?.fields.gallery).toEqual(["media_1", "media_2"]);
    expect(result.included.entries[0]?.fields.avatar).toBe("media_2");
    expect(result.included.assets.map((asset) => asset.id)).toEqual([
      "media_1",
    ]);
    expect(result.errors).toEqual([]);
  });

  it("rejects unsupported filter field types", async () => {
    await expect(
      listContentEntries(
        { repo },
        {
          modelId: "blog",
          filters: {
            author: { $eq: "author_1" },
          },
        },
      ),
    ).rejects.toBeInstanceOf(InvalidFilterError);
  });

  it("returns single entry by id with side-loaded assets", async () => {
    const result = await getContentEntry(
      { repo },
      { modelId: "blog", entryId: "entry_pub", includeMedia: true },
    );

    expect(result?.item.id).toBe("entry_pub");
    expect(result?.included.entries).toHaveLength(1);
    expect(result?.item.fields.hero).toBe("media_1");
    expect(result?.item.fields.gallery).toEqual(["media_1", "media_2"]);
    expect(result?.included.assets).toHaveLength(2);
  });
});
