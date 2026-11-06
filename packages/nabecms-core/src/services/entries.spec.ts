import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  bulkPublishEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  publishEntryRevision,
  restoreEntryRevision,
  unpublishEntry,
  type BulkPublishEntriesParams,
  type CreateEntryParams,
  type UpdateEntryParams,
  type PublishEntryRevisionParams,
  type RestoreEntryRevisionParams,
  type EntriesServiceDeps,
  BulkUniqueFieldConflictError,
  EntryQueryBudgetExceededError,
  EntryModelNotFoundError,
  EntryFieldNotFoundError,
  EntryFieldValidationError,
  EntryLocaleNotFoundError,
  EntryNotFoundError,
  EntryReferencedError,
  EntryRevisionNotFoundError,
  UniqueFieldConflictError,
} from "./entries";
import type { MediaRecord } from "../repositories/media";

type RepoOverrides = Partial<EntriesServiceDeps["repo"]>;
type MediaRepoOverrides = Partial<EntriesServiceDeps["mediaRepo"]>;
type TestEntriesServiceDeps = EntriesServiceDeps & {
  auditLog: ReturnType<typeof vi.fn>;
};

const defaultModel = {
  id: "model_posts",
  name: "Posts",
};

const defaultFields = [
  {
    id: "field_title",
    modelId: "model_posts",
    name: "title",
    type: "text",
    hasLocales: true,
    required: true,
    isPrivate: false,
    isUnique: false,
    variant: null,
  },
  {
    id: "field_body",
    modelId: "model_posts",
    name: "body",
    type: "rich_text",
    hasLocales: true,
    required: false,
    isPrivate: false,
    isUnique: false,
    variant: null,
  },
  {
    id: "field_featured",
    modelId: "model_posts",
    name: "featured",
    type: "boolean",
    hasLocales: false,
    required: false,
    isPrivate: false,
    isUnique: false,
    variant: null,
  },
];

const createMediaRecord = (id: string, type = "image"): MediaRecord => ({
  id,
  groupId: "group_test",
  url: `media/test/${id}`,
  type,
  mimeType: `${type}/test`,
  name: `${id}.bin`,
  description: null,
  width: null,
  height: null,
  size: 1,
  status: "published",
  createdAt: "2025-09-26T00:00:00.000Z",
  updatedAt: "2025-09-26T00:00:00.000Z",
  updatedBy: "user_admin",
});

const baseDeps = (
  repoOverrides: RepoOverrides = {},
  mediaRepoOverrides: MediaRepoOverrides = {},
): TestEntriesServiceDeps => {
  const repo: EntriesServiceDeps["repo"] = {
    findModelWithFields: vi.fn().mockResolvedValue({
      model: defaultModel,
      fields: defaultFields,
    }),
    findDefaultLocale: vi.fn().mockResolvedValue("en"),
    localeExists: vi.fn().mockResolvedValue(true),
    insertEntry: vi.fn(),
    insertEntryFields: vi.fn(),
    findEntryById: vi.fn().mockResolvedValue({
      id: "entry_existing",
      modelId: defaultModel.id,
      status: "draft",
      createdAt: "2025-09-25T00:00:00.000Z",
      updatedAt: "2025-09-25T00:00:00.000Z",
      publishedAt: null,
      currentDraftRevisionId: null,
      publishedRevisionId: null,
    }),
    findEntriesByIds: vi.fn().mockResolvedValue([]),
    updateEntry: vi.fn(),
    deleteEntryFields: vi.fn(),
    getNextRevisionNumber: vi.fn().mockResolvedValue(2),
    insertEntryRevision: vi.fn(),
    updateEntryRevision: vi.fn(),
    findRevisionById: vi.fn().mockResolvedValue(null),
    findDraftRevision: vi.fn().mockResolvedValue(null),
    listRevisions: vi.fn().mockResolvedValue([]),
    listEntryReferenceFields: vi.fn().mockResolvedValue([]),
    listCurrentDraftRevisions: vi.fn().mockResolvedValue([]),
    updateEntryFieldReferenceValues: vi.fn(),
    deleteEntryRevisions: vi.fn(),
    deleteEntry: vi.fn(),
    findUniqueFieldConflict: vi.fn().mockResolvedValue(null),
    ...repoOverrides,
  };
  const logAuditEvent = vi.fn().mockResolvedValue(undefined);

  return {
    repo,
    mediaRepo: {
      findByIds: vi
        .fn()
        .mockImplementation((ids: readonly string[]) =>
          Promise.resolve(ids.map((id) => createMediaRecord(id))),
        ),
      ...mediaRepoOverrides,
    },
    generateId: vi
      .fn()
      .mockImplementation(
        (prefix: string) =>
          `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
      ),
    now: () => new Date("2025-09-26T12:00:00.000Z"),
    runAtomicWrite: vi.fn(async (work) => await work({ repo, logAuditEvent })),
    auditLog: logAuditEvent,
  } satisfies TestEntriesServiceDeps;
};

describe("entries service", () => {
  const params: CreateEntryParams = {
    actorId: "user_admin",
    modelId: "model_posts",
    status: "draft",
    fields: [
      {
        fieldId: "field_title",
        locale: "en",
        value: "Hello World",
      },
      {
        fieldId: "field_body",
        locale: "en",
        value: {
          type: "rich_text",
          value: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Body" }] },
            ],
          },
        },
      },
      {
        fieldId: "field_featured",
        value: true,
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const requiredFieldBase = {
    id: "field_required",
    modelId: defaultModel.id,
    name: "required",
    hasLocales: false,
    required: true,
    isPrivate: false,
    isUnique: false,
    variant: null,
  };

  const requiredEmptyCases = [
    {
      label: "text",
      field: { ...requiredFieldBase, type: "text" },
      value: " ",
    },
    {
      label: "rich_text",
      field: { ...requiredFieldBase, type: "rich_text" },
      value: {
        type: "rich_text",
        value: { type: "doc", content: [{ type: "paragraph" }] },
      },
    },
    {
      label: "number",
      field: { ...requiredFieldBase, type: "number" },
      value: null,
    },
    {
      label: "date",
      field: { ...requiredFieldBase, type: "date" },
      value: "",
    },
    {
      label: "boolean",
      field: { ...requiredFieldBase, type: "boolean" },
      value: null,
    },
    {
      label: "media",
      field: { ...requiredFieldBase, type: "media", variant: "single" },
      value: null,
    },
    {
      label: "relation",
      field: {
        ...requiredFieldBase,
        type: "relation",
        variant: "many",
        options: { allowedModels: ["model_posts"] },
      },
      value: { type: "many", entryIds: [] },
    },
    {
      label: "list",
      field: {
        ...requiredFieldBase,
        type: "list",
        options: { item: { type: "text" } },
      },
      value: [],
    },
    {
      label: "json",
      field: { ...requiredFieldBase, type: "json" },
      value: null,
    },
  ];

  const createDateField = (
    format: "date" | "datetime" | "datetime_with_timezone",
  ) => ({
    id: "field_date",
    modelId: defaultModel.id,
    name: "eventDate",
    type: "date",
    hasLocales: false,
    required: false,
    isPrivate: false,
    isUnique: false,
    variant: format === "date" ? "date" : "datetime",
    options: { format },
  });

  const createDateSnapshot = (valueDate: string | null) => ({
    fieldId: "field_date",
    locale: "en",
    type: "date",
    valueString: null,
    valueNumber: null,
    valueDate,
    valueBoolean: null,
    valueJson: null,
    valueMedia: null,
    valueRelation: null,
  });

  const jsonFieldSchema = {
    type: "object",
    required: ["title", "meta"],
    properties: {
      title: { type: "string" },
      meta: {
        type: "object",
        required: ["count"],
        properties: {
          count: { type: "integer" },
        },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
          },
        },
      },
    },
  } as const;

  const createJsonField = (stripUnknown = false) => ({
    id: "field_metadata",
    modelId: defaultModel.id,
    name: "metadata",
    type: "json" as const,
    hasLocales: false,
    required: false,
    isPrivate: false,
    isUnique: false,
    variant: null,
    options: { schema: jsonFieldSchema, stripUnknown },
  });

  const createJsonSnapshot = (valueJson: unknown) => ({
    fieldId: "field_metadata",
    locale: "en",
    type: "json" as const,
    valueString: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson,
    valueMedia: null,
    valueRelation: null,
  });

  const dateFormatCases = [
    {
      label: "date",
      format: "date",
      input: "2026-03-10",
      expected: "2026-03-10",
      invalid: "2026-03-10T09:30:00Z",
    },
    {
      label: "datetime",
      format: "datetime",
      input: "2026-03-10T09:30",
      expected: "2026-03-10T09:30:00",
      invalid: "2026-03-10T09:30:00Z",
    },
    {
      label: "datetime_with_timezone",
      format: "datetime_with_timezone",
      input: "2026-03-10T09:30:00+09:00",
      expected: "2026-03-10T00:30:00.000Z",
      invalid: "2026-03-10T09:30:00",
    },
  ] as const;

  it("creates a published entry with revision and field snapshot", async () => {
    const deps = baseDeps();
    const entryId = "entry_123456";
    const revisionId = "entry_revision_789";
    const fieldIds = ["entry_field_a", "entry_field_b", "entry_field_c"];
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce(entryId)
      .mockReturnValueOnce(revisionId)
      .mockReturnValueOnce(fieldIds[0])
      .mockReturnValueOnce(fieldIds[1])
      .mockReturnValueOnce(fieldIds[2]);

    const publishedParams: CreateEntryParams = {
      ...params,
      status: "published",
    };

    const created = await createEntry(deps, publishedParams);

    expect(deps.repo.insertEntry).toHaveBeenCalledWith({
      id: entryId,
      modelId: publishedParams.modelId,
      status: "published",
      createdAt: "2025-09-26T12:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
      updatedBy: publishedParams.actorId,
      currentDraftRevisionId: null,
      publishedRevisionId: null,
    });

    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith({
      id: revisionId,
      entryId,
      revisionNumber: 1,
      content: expect.objectContaining({ status: "published" }),
      status: "published",
      createdBy: publishedParams.actorId,
      createdAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
    });

    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        id: fieldIds[0],
        entryId,
        fieldId: "field_title",
        locale: "en",
        valueString: "Hello World",
      }),
      expect.objectContaining({
        id: fieldIds[1],
        entryId,
        fieldId: "field_body",
        valueJson: params.fields![1]!.value,
      }),
      expect.objectContaining({
        id: fieldIds[2],
        entryId,
        fieldId: "field_featured",
        valueBoolean: true,
      }),
    ]);

    expect(deps.repo.updateEntry).toHaveBeenCalledWith(entryId, {
      status: "published",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
      updatedBy: publishedParams.actorId,
      currentDraftRevisionId: null,
      publishedRevisionId: revisionId,
    });

    expect(created).toEqual({
      id: entryId,
      modelId: publishedParams.modelId,
      status: "published",
      createdAt: "2025-09-26T12:00:00.000Z",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: "2025-09-26T12:00:00.000Z",
    });
    expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
  });

  it("falls back to default locale when not provided", async () => {
    const deps = baseDeps();
    const entryId = "entry_default_locale";
    const revisionId = "entry_revision_locale";
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce(entryId)
      .mockReturnValueOnce(revisionId);

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: params.status,
      fields: [{ fieldId: "field_title", value: "No locale" }],
    });

    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        id: revisionId,
        content: expect.objectContaining({
          fields: [expect.objectContaining({ locale: "en" })],
        }),
      }),
    );
  });

  it("normalizes a single explicit locale on non-localized fields to the default locale", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [defaultFields[2]],
      }),
    });
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce("entry_non_localized")
      .mockReturnValueOnce("entry_revision_non_localized")
      .mockReturnValueOnce("entry_field_non_localized");

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "published",
      fields: [{ fieldId: "field_featured", locale: "ja", value: true }],
    });

    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          fields: [
            expect.objectContaining({
              fieldId: "field_featured",
              locale: "en",
              valueBoolean: true,
            }),
          ],
        }),
      }),
    );
    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: "field_featured",
        locale: "en",
        valueBoolean: true,
      }),
    ]);
  });

  it("rejects multiple locale payloads for non-localized fields on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [defaultFields[2]],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [
          { fieldId: "field_featured", locale: "en", value: true },
          { fieldId: "field_featured", locale: "ja", value: false },
        ],
      }),
    ).rejects.toMatchObject({
      fieldId: "field_featured",
      reason: "non-localized fields cannot contain multiple locale values",
    });

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
  });

  it.each(requiredEmptyCases)(
    "rejects empty required $label fields on create",
    async ({ field, value }) => {
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        createEntry(deps, {
          actorId: params.actorId,
          modelId: params.modelId,
          status: "draft",
          fields: [{ fieldId: field.id, value }],
        }),
      ).rejects.toMatchObject({
        fieldId: field.id,
        reason: "required field is empty",
      });

      expect(deps.repo.insertEntry).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
    },
  );

  it("accepts false as a required boolean value", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [{ ...requiredFieldBase, type: "boolean" }],
      }),
    });

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "draft",
      fields: [{ fieldId: requiredFieldBase.id, value: false }],
    });

    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          fields: [
            expect.objectContaining({
              fieldId: requiredFieldBase.id,
              valueBoolean: false,
            }),
          ],
        }),
      }),
    );
  });

  it("rejects missing required localized values for the default locale", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            ...requiredFieldBase,
            type: "text",
            hasLocales: true,
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [],
      }),
    ).rejects.toMatchObject({
      fieldId: requiredFieldBase.id,
      reason: "required field is empty for locale 'en'",
    });

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
  });

  it("rejects empty required localized values for each provided locale", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            ...requiredFieldBase,
            type: "text",
            hasLocales: true,
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [
          { fieldId: requiredFieldBase.id, locale: "en", value: "Hello" },
          { fieldId: requiredFieldBase.id, locale: "ja", value: " " },
        ],
      }),
    ).rejects.toMatchObject({
      fieldId: requiredFieldBase.id,
      reason: "required field is empty for locale 'ja'",
    });

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
  });

  it("stores multiple media fields as ordered JSON media IDs", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_gallery",
            modelId: defaultModel.id,
            name: "gallery",
            type: "media",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "multiple",
          },
        ],
      }),
    });
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce("entry_media")
      .mockReturnValueOnce("entry_revision_media")
      .mockReturnValueOnce("entry_field_media");

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "published",
      fields: [
        {
          fieldId: "field_gallery",
          value: ["media_1", "media_2"],
        },
      ],
    });

    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          fields: [
            expect.objectContaining({
              fieldId: "field_gallery",
              valueJson: ["media_1", "media_2"],
              valueMedia: null,
            }),
          ],
        }),
      }),
    );
    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: "field_gallery",
        valueJson: ["media_1", "media_2"],
        valueMedia: null,
      }),
    ]);
  });

  it("rejects missing single media IDs on draft create", async () => {
    const deps = baseDeps(
      {
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_hero",
              modelId: defaultModel.id,
              name: "hero",
              type: "media",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "single",
            },
          ],
        }),
      },
      { findByIds: vi.fn().mockResolvedValue([]) },
    );

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [{ fieldId: "field_hero", value: "media_missing" }],
      }),
    ).rejects.toMatchObject({
      fieldId: "field_hero",
      reason: "media 'media_missing' does not exist",
    });

    expect(deps.mediaRepo.findByIds).toHaveBeenCalledWith(["media_missing"]);
    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
  });

  it("rejects media IDs whose type is outside allowedKinds", async () => {
    const deps = baseDeps(
      {
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_hero",
              modelId: defaultModel.id,
              name: "hero",
              type: "media",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "single",
              options: { allowedKinds: ["image"] },
            },
          ],
        }),
      },
      {
        findByIds: vi
          .fn()
          .mockResolvedValue([createMediaRecord("media_video", "video")]),
      },
    );

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [{ fieldId: "field_hero", value: "media_video" }],
      }),
    ).rejects.toMatchObject({
      fieldId: "field_hero",
      reason: "media 'media_video' type 'video' is not allowed",
    });

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
  });

  it("rejects missing IDs in multiple media fields", async () => {
    const deps = baseDeps(
      {
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_gallery",
              modelId: defaultModel.id,
              name: "gallery",
              type: "media",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "multiple",
            },
          ],
        }),
      },
      {
        findByIds: vi.fn().mockResolvedValue([createMediaRecord("media_1")]),
      },
    );

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [
          {
            fieldId: "field_gallery",
            value: ["media_1", "media_missing", "media_1"],
          },
        ],
      }),
    ).rejects.toMatchObject({
      fieldId: "field_gallery",
      reason: "media 'media_missing' does not exist",
    });

    expect(deps.mediaRepo.findByIds).toHaveBeenCalledWith([
      "media_1",
      "media_missing",
    ]);
    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
  });

  it("normalizes number field variants and decimal strings on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_count",
            modelId: defaultModel.id,
            name: "count",
            type: "number",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "integer",
          },
          {
            id: "field_rating",
            modelId: defaultModel.id,
            name: "rating",
            type: "number",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "decimal",
          },
        ],
      }),
    });
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce("entry_numbers")
      .mockReturnValueOnce("entry_revision_numbers")
      .mockReturnValueOnce("entry_field_count")
      .mockReturnValueOnce("entry_field_rating");

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "published",
      fields: [
        { fieldId: "field_count", value: "42" },
        { fieldId: "field_rating", value: "-1.25e2" },
      ],
    });

    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: "field_count",
        valueNumber: 42,
      }),
      expect.objectContaining({
        fieldId: "field_rating",
        valueNumber: -125,
      }),
    ]);
  });

  it("rejects fractional values for integer number fields on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_count",
            modelId: defaultModel.id,
            name: "count",
            type: "number",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "integer",
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [{ fieldId: "field_count", value: "1.5" }],
      }),
    ).rejects.toMatchObject({
      fieldId: "field_count",
      reason: "integer number fields must be safe integers",
    });

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
  });

  it("rejects non-decimal number strings on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_rating",
            modelId: defaultModel.id,
            name: "rating",
            type: "number",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "decimal",
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [{ fieldId: "field_rating", value: "0x10" }],
      }),
    ).rejects.toMatchObject({
      fieldId: "field_rating",
      reason: "number strings must be decimal numeric literals",
    });
  });

  it("applies model field defaults to missing fields on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            ...defaultFields[0],
            defaultValue: "Untitled",
          },
          {
            ...defaultFields[1],
            defaultValue: {
              type: "rich_text",
              value: { type: "doc", content: [{ type: "paragraph" }] },
            },
          },
          {
            ...defaultFields[2],
            defaultValue: true,
          },
          {
            id: "field_tags",
            modelId: defaultModel.id,
            name: "tags",
            type: "list",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: { item: { type: "text" } },
            defaultValue: ["news"],
          },
          {
            id: "field_hero",
            modelId: defaultModel.id,
            name: "hero",
            type: "media",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "single",
            defaultValue: "media_1",
          },
          {
            id: "field_related",
            modelId: defaultModel.id,
            name: "related",
            type: "relation",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "many",
            options: { allowedModels: ["model_posts"] },
            defaultValue: { entryIds: ["entry_1"] },
          },
        ],
      }),
    });
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce("entry_defaults")
      .mockReturnValueOnce("entry_revision_defaults")
      .mockReturnValueOnce("entry_field_title")
      .mockReturnValueOnce("entry_field_featured")
      .mockReturnValueOnce("entry_field_tags");

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "published",
      fields: [],
    });

    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          fields: [
            expect.objectContaining({
              fieldId: "field_title",
              locale: "en",
              valueString: "Untitled",
            }),
            expect.objectContaining({
              fieldId: "field_featured",
              locale: "en",
              valueBoolean: true,
            }),
            expect.objectContaining({
              fieldId: "field_tags",
              locale: "en",
              valueJson: ["news"],
            }),
          ],
        }),
      }),
    );
    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: "field_title",
        valueString: "Untitled",
      }),
      expect.objectContaining({
        fieldId: "field_featured",
        valueBoolean: true,
      }),
      expect.objectContaining({
        fieldId: "field_tags",
        valueJson: ["news"],
      }),
    ]);
    const revisionCall = vi.mocked(deps.repo.insertEntryRevision).mock
      .calls[0]![0] as { content: { fields: Array<{ fieldId: string }> } };
    expect(
      revisionCall.content.fields.map((field) => field.fieldId),
    ).not.toContain("field_body");
    expect(
      revisionCall.content.fields.map((field) => field.fieldId),
    ).not.toContain("field_hero");
    expect(
      revisionCall.content.fields.map((field) => field.fieldId),
    ).not.toContain("field_related");
  });

  it("stores list fields as typed JSON arrays", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_scores",
            modelId: defaultModel.id,
            name: "scores",
            type: "list",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: { item: { type: "number" } },
          },
          {
            id: "field_dates",
            modelId: defaultModel.id,
            name: "dates",
            type: "list",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: { item: { type: "date" } },
          },
          {
            id: "field_flags",
            modelId: defaultModel.id,
            name: "flags",
            type: "list",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: { item: { type: "boolean" } },
          },
        ],
      }),
    });
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce("entry_list")
      .mockReturnValueOnce("entry_revision_list")
      .mockReturnValueOnce("entry_field_scores")
      .mockReturnValueOnce("entry_field_dates")
      .mockReturnValueOnce("entry_field_flags");

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "published",
      fields: [
        { fieldId: "field_scores", value: [1, 2.5] },
        { fieldId: "field_dates", value: ["2026-03-10"] },
        { fieldId: "field_flags", value: [true, false] },
      ],
    });

    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: "field_scores",
        valueJson: [1, 2.5],
      }),
      expect.objectContaining({
        fieldId: "field_dates",
        valueJson: ["2026-03-10"],
      }),
      expect.objectContaining({
        fieldId: "field_flags",
        valueJson: [true, false],
      }),
    ]);
  });

  it("rejects list values that do not match the configured item type", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_scores",
            modelId: defaultModel.id,
            name: "scores",
            type: "list",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: { item: { type: "number" } },
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [{ fieldId: "field_scores", value: ["1"] }],
      }),
    ).rejects.toBeInstanceOf(EntryFieldValidationError);

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
  });

  it("rejects invalid list date values", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_dates",
            modelId: defaultModel.id,
            name: "dates",
            type: "list",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: null,
            options: { item: { type: "date" } },
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [{ fieldId: "field_dates", value: ["2026-02-30"] }],
      }),
    ).rejects.toBeInstanceOf(EntryFieldValidationError);
  });

  it("stores relation fields only when target entries exist in allowed models", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_author",
            modelId: defaultModel.id,
            name: "author",
            type: "relation",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "many",
            options: { allowedModels: ["model_authors"] },
          },
        ],
      }),
      findEntriesByIds: vi
        .fn()
        .mockResolvedValue([{ id: "entry_author", modelId: "model_authors" }]),
    });
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce("entry_relation")
      .mockReturnValueOnce("entry_revision_relation")
      .mockReturnValueOnce("entry_field_relation");

    await createEntry(deps, {
      actorId: params.actorId,
      modelId: params.modelId,
      status: "published",
      fields: [
        {
          fieldId: "field_author",
          value: { type: "many", entryIds: ["entry_author"] },
        },
      ],
    });

    expect(deps.repo.findEntriesByIds).toHaveBeenCalledWith(["entry_author"]);
    expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldId: "field_author",
        valueRelation: { type: "many", entryIds: ["entry_author"] },
      }),
    ]);
  });

  it("rejects relation targets from disallowed models on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_author",
            modelId: defaultModel.id,
            name: "author",
            type: "relation",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "many",
            options: { allowedModels: ["model_authors"] },
          },
        ],
      }),
      findEntriesByIds: vi
        .fn()
        .mockResolvedValue([
          { id: "entry_product", modelId: "model_products" },
        ]),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [
          {
            fieldId: "field_author",
            value: { type: "many", entryIds: ["entry_product"] },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(EntryFieldValidationError);

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
  });

  it("rejects relation one values with multiple target entries", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          {
            id: "field_author",
            modelId: defaultModel.id,
            name: "author",
            type: "relation",
            hasLocales: false,
            required: false,
            isPrivate: false,
            isUnique: false,
            variant: "one",
            options: { allowedModels: ["model_authors"] },
          },
        ],
      }),
    });

    await expect(
      createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [
          {
            fieldId: "field_author",
            value: {
              type: "one",
              entryIds: ["entry_author_1", "entry_author_2"],
            },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(EntryFieldValidationError);

    expect(deps.repo.findEntriesByIds).not.toHaveBeenCalled();
    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
  });
  it.each(dateFormatCases)(
    "normalizes $label date field values on create",
    async ({ format, input, expected }) => {
      const field = createDateField(format);
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });
      vi.mocked(deps.generateId as Mock)
        .mockReturnValueOnce("entry_date")
        .mockReturnValueOnce("entry_revision_date")
        .mockReturnValueOnce("entry_field_date");

      await createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "published",
        fields: [{ fieldId: field.id, value: input }],
      });

      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [expect.objectContaining({ valueDate: expected })],
          }),
        }),
      );
      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({ fieldId: field.id, valueDate: expected }),
      ]);
    },
  );

  describe("json field validation on create", () => {
    it("rejects values that violate the configured JSON schema", async () => {
      const field = createJsonField();
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        createEntry(deps, {
          actorId: params.actorId,
          modelId: params.modelId,
          status: "draft",
          fields: [
            {
              fieldId: field.id,
              value: { title: 42, meta: { count: 1 } },
            },
          ],
        }),
      ).rejects.toMatchObject({
        fieldId: field.id,
        reason: expect.stringContaining("json schema validation failed"),
      });

      expect(deps.repo.insertEntry).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
    });

    it("strips unknown keys recursively without mutating the request value", async () => {
      const field = createJsonField(true);
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });
      const value = {
        title: "Hello",
        ignored: true,
        meta: { count: 1, ignored: "nested" },
        items: [{ name: "First", ignored: "array item" }],
      };

      await createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [{ fieldId: field.id, value }],
      });

      expect(value).toEqual({
        title: "Hello",
        ignored: true,
        meta: { count: 1, ignored: "nested" },
        items: [{ name: "First", ignored: "array item" }],
      });
      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [
              expect.objectContaining({
                fieldId: field.id,
                valueJson: {
                  title: "Hello",
                  meta: { count: 1 },
                  items: [{ name: "First" }],
                },
              }),
            ],
          }),
        }),
      );
    });

    it("keeps unknown keys and does not mutate values when stripUnknown is false", async () => {
      const field = createJsonField();
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });
      const value = {
        title: "Hello",
        extra: "kept",
        meta: { count: 1, extra: "kept" },
      };

      await createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [{ fieldId: field.id, value }],
      });

      expect(value).toEqual({
        title: "Hello",
        extra: "kept",
        meta: { count: 1, extra: "kept" },
      });
      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [
              expect.objectContaining({
                fieldId: field.id,
                valueJson: value,
              }),
            ],
          }),
        }),
      );
    });

    it("validates and strips a configured JSON default value", async () => {
      const field = {
        ...createJsonField(true),
        defaultValue: {
          title: "Default",
          ignored: true,
          meta: { count: 1, ignored: "nested" },
        },
      };
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await createEntry(deps, {
        actorId: params.actorId,
        modelId: params.modelId,
        status: "draft",
        fields: [],
      });

      expect(field.defaultValue).toEqual({
        title: "Default",
        ignored: true,
        meta: { count: 1, ignored: "nested" },
      });
      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [
              expect.objectContaining({
                fieldId: field.id,
                valueJson: {
                  title: "Default",
                  meta: { count: 1 },
                },
              }),
            ],
          }),
        }),
      );
    });

    it("rejects an invalid configured JSON schema", async () => {
      const field = {
        ...createJsonField(),
        options: { schema: { type: "not-a-json-schema-type" } },
      };
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        createEntry(deps, {
          actorId: params.actorId,
          modelId: params.modelId,
          status: "draft",
          fields: [
            {
              fieldId: field.id,
              value: { title: "Hello", meta: { count: 1 } },
            },
          ],
        }),
      ).rejects.toMatchObject({
        fieldId: field.id,
        reason: expect.stringContaining("json schema is invalid"),
      });

      expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    });

    it("requires a schema when stripUnknown is enabled", async () => {
      const field = {
        ...createJsonField(),
        options: { stripUnknown: true },
      };
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        createEntry(deps, {
          actorId: params.actorId,
          modelId: params.modelId,
          status: "draft",
          fields: [{ fieldId: field.id, value: { title: "Hello" } }],
        }),
      ).rejects.toMatchObject({
        fieldId: field.id,
        reason: "json stripUnknown requires options.schema",
      });

      expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    });
  });

  it.each(dateFormatCases)(
    "rejects invalid $label date field values on create",
    async ({ format, invalid }) => {
      const field = createDateField(format);
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        createEntry(deps, {
          actorId: params.actorId,
          modelId: params.modelId,
          status: "published",
          fields: [{ fieldId: field.id, value: invalid }],
        }),
      ).rejects.toBeInstanceOf(EntryFieldValidationError);

      expect(deps.repo.insertEntry).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
    },
  );

  it("throws when model is not found", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue(null),
    });

    await expect(createEntry(deps, params)).rejects.toBeInstanceOf(
      EntryModelNotFoundError,
    );
  });

  it("throws when unique field value conflicts on create", async () => {
    const deps = baseDeps({
      findModelWithFields: vi.fn().mockResolvedValue({
        model: defaultModel,
        fields: [
          { ...defaultFields[0], isUnique: true },
          defaultFields[1],
          defaultFields[2],
        ],
      }),
      findUniqueFieldConflict: vi
        .fn()
        .mockResolvedValue({ entryId: "entry_dup" }),
    });

    await expect(
      createEntry(deps, {
        ...params,
        status: "published",
        fields: [
          { fieldId: "field_title", locale: "en", value: "Hello World" },
        ],
      }),
    ).rejects.toBeInstanceOf(UniqueFieldConflictError);
    expect(deps.runAtomicWrite).not.toHaveBeenCalled();
    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
  });

  it("throws when a field definition is missing", async () => {
    const deps = baseDeps();

    await expect(
      createEntry(deps, {
        ...params,
        fields: [{ fieldId: "unknown", value: "oops" }],
      }),
    ).rejects.toBeInstanceOf(EntryFieldNotFoundError);
  });

  it("throws when a field locale is not configured", async () => {
    const deps = baseDeps({
      localeExists: vi.fn().mockResolvedValue(false),
    });

    await expect(
      createEntry(deps, {
        ...params,
        fields: [{ fieldId: "field_title", locale: "fr", value: "Bonjour" }],
      }),
    ).rejects.toBeInstanceOf(EntryLocaleNotFoundError);

    expect(deps.repo.insertEntry).not.toHaveBeenCalled();
    expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
  });

  it("stores draft revisions without touching entry fields", async () => {
    const deps = baseDeps();
    const entryId = "entry_draft";
    const revisionId = "entry_revision_draft";
    vi.mocked(deps.generateId as Mock)
      .mockReturnValueOnce(entryId)
      .mockReturnValueOnce(revisionId);

    await createEntry(deps, params);

    expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
    expect(deps.repo.insertEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        id: entryId,
        status: "draft",
        currentDraftRevisionId: null,
        publishedRevisionId: null,
      }),
    );
    expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
      expect.objectContaining({ id: revisionId, status: "draft" }),
    );
    expect(deps.repo.updateEntry).toHaveBeenCalledWith(entryId, {
      status: "draft",
      updatedAt: "2025-09-26T12:00:00.000Z",
      publishedAt: null,
      updatedBy: params.actorId,
      currentDraftRevisionId: revisionId,
      publishedRevisionId: null,
    });
  });

  describe("deleteEntry", () => {
    const deleteParams = {
      actorId: "user_admin",
      entryId: "entry_existing",
      modelId: defaultModel.id,
    };

    it("blocks deletion when current fields reference the entry", async () => {
      const deps = baseDeps({
        listEntryReferenceFields: vi.fn().mockResolvedValue([
          {
            id: "entry_field_relation",
            entryId: "entry_source",
            fieldId: "field_related",
            fieldType: "relation",
            valueJson: null,
            valueRelation: { type: "many", entryIds: ["entry_existing"] },
          },
        ]),
      });

      await expect(deleteEntry(deps, deleteParams)).rejects.toBeInstanceOf(
        EntryReferencedError,
      );
      expect(deps.repo.deleteEntry).not.toHaveBeenCalled();
      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
    });

    it("detaches current field and draft revision references before deletion when requested", async () => {
      const richTextValue = {
        type: "rich_text",
        value: {
          type: "doc",
          content: [
            {
              type: "entryReference",
              attrs: { entryId: "entry_existing" },
            },
            {
              type: "entryReference",
              attrs: { entryId: "entry_keep" },
            },
          ],
        },
      };
      const draftField = {
        fieldId: "field_body",
        locale: "en",
        type: "rich_text",
        valueString: null,
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: richTextValue,
        valueMedia: null,
        valueRelation: null,
      };
      const deps = baseDeps({
        findEntryById: vi.fn().mockImplementation(async (id: string) => ({
          id,
          modelId: defaultModel.id,
          status: "published",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-25T00:00:00.000Z",
          publishedAt: "2025-09-21T00:00:00.000Z",
          currentDraftRevisionId:
            id === "entry_draft_source" ? "revision_draft_source" : null,
          publishedRevisionId: "revision_live",
        })),
        listEntryReferenceFields: vi.fn().mockResolvedValue([
          {
            id: "entry_field_relation",
            entryId: "entry_source",
            fieldId: "field_related",
            fieldType: "relation",
            valueJson: null,
            valueRelation: {
              type: "many",
              entryIds: ["entry_existing", "entry_keep"],
            },
          },
        ]),
        listCurrentDraftRevisions: vi.fn().mockResolvedValue([
          {
            entryId: "entry_draft_source",
            revisionId: "revision_draft_source",
            content: {
              status: "draft",
              fields: [draftField],
            },
          },
        ]),
      });

      await deleteEntry(deps, {
        ...deleteParams,
        referenceAction: "detach",
      });

      expect(deps.repo.updateEntryFieldReferenceValues).toHaveBeenCalledWith(
        "entry_field_relation",
        expect.objectContaining({
          valueRelation: { type: "many", entryIds: ["entry_keep"] },
        }),
      );
      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        "revision_draft_source",
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [
              expect.objectContaining({
                valueJson: expect.objectContaining({
                  value: expect.objectContaining({
                    content: [
                      {
                        type: "entryReference",
                        attrs: { entryId: "entry_keep" },
                      },
                    ],
                  }),
                }),
              }),
            ],
          }),
        }),
      );
      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        "entry_source",
        expect.objectContaining({
          updatedAt: "2025-09-26T12:00:00.000Z",
          updatedBy: deleteParams.actorId,
        }),
      );
      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        "entry_draft_source",
        expect.objectContaining({
          currentDraftRevisionId: "revision_draft_source",
          updatedAt: "2025-09-26T12:00:00.000Z",
        }),
      );
      expect(deps.repo.deleteEntryFields).toHaveBeenCalledWith(
        "entry_existing",
      );
      expect(deps.repo.deleteEntryRevisions).toHaveBeenCalledWith(
        "entry_existing",
      );
      expect(deps.repo.deleteEntry).toHaveBeenCalledWith("entry_existing");
      expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateEntry", () => {
    const updateParams: UpdateEntryParams = {
      actorId: "user_editor",
      entryId: "entry_existing",
      modelId: defaultModel.id,
      status: "published",
      fields: [
        { fieldId: "field_title", locale: "en", value: "Updated" },
        {
          fieldId: "field_body",
          locale: "en",
          value: {
            type: "rich_text",
            value: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Updated body" }],
                },
              ],
            },
          },
        },
      ],
    };

    it("updates entry status and fields", async () => {
      const deps = baseDeps();
      const revisionId = "entry_revision_update";
      const fieldIds = ["entry_field_u1", "entry_field_u2"];
      vi.mocked(deps.generateId as Mock)
        .mockReturnValueOnce(fieldIds[0])
        .mockReturnValueOnce(fieldIds[1])
        .mockReturnValueOnce(revisionId);

      const updated = await updateEntry(deps, updateParams);

      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          id: revisionId,
          status: "published",
          entryId: "entry_existing",
        }),
      );

      expect(deps.repo.updateEntry).toHaveBeenCalledWith("entry_existing", {
        status: "published",
        updatedAt: "2025-09-26T12:00:00.000Z",
        publishedAt: "2025-09-26T12:00:00.000Z",
        updatedBy: "user_editor",
        currentDraftRevisionId: null,
        publishedRevisionId: revisionId,
      });

      expect(deps.repo.deleteEntryFields).toHaveBeenCalledWith(
        "entry_existing",
      );
      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({
          id: fieldIds[0],
          fieldId: "field_title",
          locale: "en",
        }),
        expect.objectContaining({
          id: fieldIds[1],
          fieldId: "field_body",
          valueJson: updateParams.fields?.[1]?.value,
        }),
      ]);

      expect(updated).toMatchObject({
        id: "entry_existing",
        status: "published",
        publishedAt: "2025-09-26T12:00:00.000Z",
      });

      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: updateParams.actorId,
          action: "update",
          targetId: updateParams.entryId,
        }),
      );
      expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
    });

    it("keeps publishedAt when already set", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: "entry_existing",
          modelId: defaultModel.id,
          status: "published",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: "2025-09-21T00:00:00.000Z",
          currentDraftRevisionId: null,
          publishedRevisionId: "revision_live",
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: "revision_live",
          entryId: "entry_existing",
          revisionNumber: 1,
          content: {
            status: "published",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Live title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "published",
          createdBy: updateParams.actorId,
          createdAt: "2025-09-21T00:00:00.000Z",
          publishedAt: "2025-09-21T00:00:00.000Z",
        }),
      });

      const revisionId = "entry_revision_existing";
      vi.mocked(deps.generateId as Mock).mockImplementation((prefix: string) =>
        prefix === "entry_revision" ? revisionId : `${prefix}_published`,
      );

      await updateEntry(deps, {
        actorId: updateParams.actorId,
        entryId: updateParams.entryId,
        modelId: updateParams.modelId,
        status: "published",
      });

      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        "entry_existing",
        expect.objectContaining({
          publishedAt: "2025-09-21T00:00:00.000Z",
          publishedRevisionId: revisionId,
        }),
      );
      expect(deps.repo.deleteEntryFields).toHaveBeenCalledWith(
        "entry_existing",
      );
      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({
          entryId: "entry_existing",
          fieldId: "field_title",
          valueString: "Live title",
        }),
      ]);
    });

    it("applies defaults to missing fields when a field payload is provided", async () => {
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              ...defaultFields[0],
              defaultValue: "Untitled",
            },
            {
              ...defaultFields[2],
              defaultValue: true,
            },
          ],
        }),
      });
      vi.mocked(deps.generateId as Mock)
        .mockReturnValueOnce("entry_field_title")
        .mockReturnValueOnce("entry_field_featured")
        .mockReturnValueOnce("entry_revision_update_defaults");

      await updateEntry(deps, {
        ...updateParams,
        fields: [{ fieldId: "field_title", locale: "en", value: "Updated" }],
      });

      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [
              expect.objectContaining({
                fieldId: "field_title",
                valueString: "Updated",
              }),
              expect.objectContaining({
                fieldId: "field_featured",
                valueBoolean: true,
              }),
            ],
          }),
        }),
      );
      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({
          fieldId: "field_title",
          valueString: "Updated",
        }),
        expect.objectContaining({
          fieldId: "field_featured",
          valueBoolean: true,
        }),
      ]);
    });

    it("rejects fractional values for integer number fields on update", async () => {
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_count",
              modelId: defaultModel.id,
              name: "count",
              type: "number",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "integer",
            },
          ],
        }),
      });

      await expect(
        updateEntry(deps, {
          ...updateParams,
          fields: [{ fieldId: "field_count", value: 1.5 }],
        }),
      ).rejects.toMatchObject({
        fieldId: "field_count",
        reason: "integer number fields must be safe integers",
      });

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("rejects multiple locale payloads for non-localized fields on update", async () => {
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [defaultFields[2]],
        }),
      });

      await expect(
        updateEntry(deps, {
          ...updateParams,
          status: "draft",
          fields: [
            { fieldId: "field_featured", locale: "en", value: true },
            { fieldId: "field_featured", locale: "ja", value: false },
          ],
        }),
      ).rejects.toMatchObject({
        fieldId: "field_featured",
        reason: "non-localized fields cannot contain multiple locale values",
      });

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("merges partial localized updates with the existing revision before validation", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: "entry_existing",
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: "revision_draft",
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: "revision_draft",
          entryId: "entry_existing",
          revisionNumber: 1,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Existing title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: updateParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
      });

      await updateEntry(deps, {
        ...updateParams,
        status: "draft",
        fields: [{ fieldId: "field_title", locale: "ja", value: "更新" }],
      });

      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                fieldId: "field_title",
                locale: "en",
                valueString: "Existing title",
              }),
              expect.objectContaining({
                fieldId: "field_title",
                locale: "ja",
                valueString: "更新",
              }),
            ]),
          }),
        }),
      );
    });

    it.each(dateFormatCases)(
      "normalizes $label date field values on update",
      async ({ format, input, expected }) => {
        const field = createDateField(format);
        const deps = baseDeps({
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [field],
          }),
        });
        vi.mocked(deps.generateId as Mock)
          .mockReturnValueOnce("entry_field_date")
          .mockReturnValueOnce("entry_revision_date");

        await updateEntry(deps, {
          ...updateParams,
          status: "published",
          fields: [{ fieldId: field.id, value: input }],
        });

        expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith(
          expect.objectContaining({
            content: expect.objectContaining({
              fields: [expect.objectContaining({ valueDate: expected })],
            }),
          }),
        );
        expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
          expect.objectContaining({ fieldId: field.id, valueDate: expected }),
        ]);
      },
    );

    it.each(dateFormatCases)(
      "rejects invalid $label date field values on update",
      async ({ format, invalid }) => {
        const field = createDateField(format);
        const deps = baseDeps({
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [field],
          }),
        });

        await expect(
          updateEntry(deps, {
            ...updateParams,
            status: "published",
            fields: [{ fieldId: field.id, value: invalid }],
          }),
        ).rejects.toBeInstanceOf(EntryFieldValidationError);

        expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
        expect(deps.repo.updateEntry).not.toHaveBeenCalled();
        expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
      },
    );

    it("rejects JSON values that violate the configured schema on update", async () => {
      const field = createJsonField();
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        updateEntry(deps, {
          ...updateParams,
          status: "draft",
          fields: [
            {
              fieldId: field.id,
              value: { title: "Updated", meta: { count: 1.5 } },
            },
          ],
        }),
      ).rejects.toMatchObject({
        fieldId: field.id,
        reason: expect.stringContaining("json schema validation failed"),
      });

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("saves a draft revision while keeping entry published", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: "entry_existing",
          modelId: defaultModel.id,
          status: "published",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: "2025-09-21T00:00:00.000Z",
          currentDraftRevisionId: "revision_old_draft",
          publishedRevisionId: "revision_live",
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: "revision_old_draft",
          entryId: "entry_existing",
          revisionNumber: 2,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Draft title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: updateParams.actorId,
          createdAt: "2025-09-25T00:00:00.000Z",
          publishedAt: null,
        }),
      });

      const revisionId = "entry_revision_new_draft";
      vi.mocked(deps.generateId as Mock).mockReturnValueOnce(revisionId);

      await updateEntry(deps, { ...updateParams, status: "draft" });

      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        "revision_old_draft",
        expect.objectContaining({ status: "archived" }),
      );
      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        "entry_existing",
        expect.objectContaining({
          status: "published",
          publishedRevisionId: "revision_live",
          currentDraftRevisionId: revisionId,
        }),
      );
    });

    it("throws when entry is missing", async () => {
      const deps = baseDeps({ findEntryById: vi.fn().mockResolvedValue(null) });

      await expect(updateEntry(deps, updateParams)).rejects.toBeInstanceOf(
        EntryNotFoundError,
      );
    });

    it("throws when model is missing", async () => {
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue(null),
      });

      await expect(updateEntry(deps, updateParams)).rejects.toBeInstanceOf(
        EntryModelNotFoundError,
      );
    });

    it("throws when field definition is missing", async () => {
      const deps = baseDeps();

      await expect(
        updateEntry(deps, {
          ...updateParams,
          fields: [{ fieldId: "unknown", value: "oops" }],
        }),
      ).rejects.toBeInstanceOf(EntryFieldNotFoundError);
    });

    it("rejects relation targets that do not exist on update", async () => {
      const deps = baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_author",
              modelId: defaultModel.id,
              name: "author",
              type: "relation",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "many",
              options: { allowedModels: ["model_authors"] },
            },
          ],
        }),
        findEntriesByIds: vi.fn().mockResolvedValue([]),
      });

      await expect(
        updateEntry(deps, {
          ...updateParams,
          fields: [
            {
              fieldId: "field_author",
              value: { type: "many", entryIds: ["entry_missing"] },
            },
          ],
        }),
      ).rejects.toBeInstanceOf(EntryFieldValidationError);

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
    });

    it("throws when an update field locale is not configured", async () => {
      const deps = baseDeps({
        localeExists: vi.fn().mockResolvedValue(false),
      });

      await expect(
        updateEntry(deps, {
          ...updateParams,
          fields: [{ fieldId: "field_title", locale: "fr", value: "Bonjour" }],
        }),
      ).rejects.toBeInstanceOf(EntryLocaleNotFoundError);

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });
  });

  describe("publishEntryRevision", () => {
    const publishParams: PublishEntryRevisionParams = {
      actorId: "user_publisher",
      entryId: "entry_publish",
      modelId: defaultModel.id,
      revisionId: "revision_draft",
    };

    it("promotes revision content to published snapshot", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 3,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Draft Title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
      });

      const fieldId = "entry_field_pub";
      vi.mocked(deps.generateId as Mock).mockReturnValueOnce(fieldId);

      const updated = await publishEntryRevision(deps, publishParams);

      expect(deps.repo.deleteEntryFields).toHaveBeenCalledWith(
        publishParams.entryId,
      );
      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({
          id: fieldId,
          fieldId: "field_title",
          valueString: "Draft Title",
        }),
      ]);

      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        publishParams.entryId,
        expect.objectContaining({
          status: "published",
          publishedRevisionId: publishParams.revisionId,
          currentDraftRevisionId: null,
        }),
      );

      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        publishParams.revisionId,
        expect.objectContaining({ status: "published" }),
      );

      expect(updated).toMatchObject({ status: "published" });
      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "publish",
          targetId: publishParams.entryId,
        }),
      );
      expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
    });

    it("revalidates and strips stored JSON revision values before publish", async () => {
      const field = createJsonField(true);
      const storedValue = {
        title: "Draft",
        ignored: true,
        meta: { count: 2, ignored: "nested" },
      };
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 3,
          content: {
            status: "draft",
            fields: [createJsonSnapshot(storedValue)],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });
      vi.mocked(deps.generateId as Mock).mockReturnValueOnce(
        "entry_field_json",
      );

      await publishEntryRevision(deps, publishParams);

      expect(storedValue).toEqual({
        title: "Draft",
        ignored: true,
        meta: { count: 2, ignored: "nested" },
      });
      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({
          fieldId: field.id,
          valueJson: { title: "Draft", meta: { count: 2 } },
        }),
      ]);
      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        publishParams.revisionId,
        expect.objectContaining({
          content: expect.objectContaining({
            fields: [
              expect.objectContaining({
                fieldId: field.id,
                valueJson: { title: "Draft", meta: { count: 2 } },
              }),
            ],
          }),
        }),
      );
    });

    it("revalidates media allowedKinds before publishing a stored revision", async () => {
      const deps = baseDeps(
        {
          findEntryById: vi.fn().mockResolvedValue({
            id: publishParams.entryId,
            modelId: defaultModel.id,
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-20T00:00:00.000Z",
            publishedAt: null,
            currentDraftRevisionId: publishParams.revisionId,
            publishedRevisionId: null,
          }),
          findRevisionById: vi.fn().mockResolvedValue({
            id: publishParams.revisionId,
            entryId: publishParams.entryId,
            revisionNumber: 3,
            content: {
              status: "draft",
              fields: [
                {
                  fieldId: "field_hero",
                  locale: "en",
                  type: "media",
                  valueString: null,
                  valueNumber: null,
                  valueDate: null,
                  valueBoolean: null,
                  valueJson: null,
                  valueMedia: "media_video",
                  valueRelation: null,
                },
              ],
            },
            status: "draft",
            createdBy: publishParams.actorId,
            createdAt: "2025-09-20T00:00:00.000Z",
            publishedAt: null,
          }),
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [
              {
                id: "field_hero",
                modelId: defaultModel.id,
                name: "hero",
                type: "media",
                hasLocales: false,
                required: false,
                isPrivate: false,
                isUnique: false,
                variant: "single",
                options: { allowedKinds: ["image"] },
              },
            ],
          }),
        },
        {
          findByIds: vi
            .fn()
            .mockResolvedValue([createMediaRecord("media_video", "video")]),
        },
      );

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toMatchObject({
        fieldId: "field_hero",
        reason: "media 'media_video' type 'video' is not allowed",
      });

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("applies model field defaults before publishing a sparse revision", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 3,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Draft Title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            defaultFields[0],
            {
              ...defaultFields[2],
              defaultValue: true,
            },
          ],
        }),
      });
      vi.mocked(deps.generateId as Mock)
        .mockReturnValueOnce("entry_field_pub_title")
        .mockReturnValueOnce("entry_field_pub_featured");

      await publishEntryRevision(deps, publishParams);

      expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
        expect.objectContaining({
          fieldId: "field_title",
          valueString: "Draft Title",
        }),
        expect.objectContaining({
          fieldId: "field_featured",
          valueBoolean: true,
        }),
      ]);
      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        publishParams.revisionId,
        expect.objectContaining({
          content: expect.objectContaining({
            status: "published",
            fields: [
              expect.objectContaining({ fieldId: "field_title" }),
              expect.objectContaining({
                fieldId: "field_featured",
                valueBoolean: true,
              }),
            ],
          }),
          status: "published",
        }),
      );
    });

    it("rejects fractional integer values when publishing a stored revision", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 1,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_count",
                locale: "en",
                type: "number",
                valueString: null,
                valueNumber: 1.5,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_count",
              modelId: defaultModel.id,
              name: "count",
              type: "number",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "integer",
            },
          ],
        }),
      });

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toMatchObject({
        fieldId: "field_count",
        reason: "integer number fields must be safe integers",
      });

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
    });

    it("rejects multiple locale snapshots for non-localized fields on publish", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 1,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_featured",
                locale: "en",
                type: "boolean",
                valueString: null,
                valueNumber: null,
                valueDate: null,
                valueBoolean: true,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
              {
                fieldId: "field_featured",
                locale: "ja",
                type: "boolean",
                valueString: null,
                valueNumber: null,
                valueDate: null,
                valueBoolean: false,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [defaultFields[2]],
        }),
      });

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toMatchObject({
        fieldId: "field_featured",
        reason: "non-localized fields cannot contain multiple locale values",
      });

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("rejects publishing a revision with an empty required field", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 3,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: " ",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
      });

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toMatchObject({
        fieldId: "field_title",
        reason: "required field is empty for locale 'en'",
      });

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it.each(dateFormatCases)(
      "normalizes $label date revision values on publish",
      async ({ format, input, expected }) => {
        const field = createDateField(format);
        const deps = baseDeps({
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [field],
          }),
          findEntryById: vi.fn().mockResolvedValue({
            id: publishParams.entryId,
            modelId: defaultModel.id,
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-20T00:00:00.000Z",
            publishedAt: null,
            currentDraftRevisionId: publishParams.revisionId,
            publishedRevisionId: null,
          }),
          findRevisionById: vi.fn().mockResolvedValue({
            id: publishParams.revisionId,
            entryId: publishParams.entryId,
            revisionNumber: 3,
            content: {
              status: "draft",
              fields: [createDateSnapshot(input)],
            },
            status: "draft",
            createdBy: publishParams.actorId,
            createdAt: "2025-09-20T00:00:00.000Z",
            publishedAt: null,
          }),
        });
        vi.mocked(deps.generateId as Mock).mockReturnValueOnce(
          "entry_field_date",
        );

        await publishEntryRevision(deps, publishParams);

        expect(deps.repo.insertEntryFields).toHaveBeenCalledWith([
          expect.objectContaining({ fieldId: field.id, valueDate: expected }),
        ]);
        expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
          publishParams.revisionId,
          expect.objectContaining({
            content: expect.objectContaining({
              fields: [expect.objectContaining({ valueDate: expected })],
            }),
          }),
        );
      },
    );

    it.each(dateFormatCases)(
      "rejects invalid $label date revision values on publish",
      async ({ format, invalid }) => {
        const field = createDateField(format);
        const deps = baseDeps({
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [field],
          }),
          findEntryById: vi.fn().mockResolvedValue({
            id: publishParams.entryId,
            modelId: defaultModel.id,
            status: "draft",
            createdAt: "2025-09-20T00:00:00.000Z",
            updatedAt: "2025-09-20T00:00:00.000Z",
            publishedAt: null,
            currentDraftRevisionId: publishParams.revisionId,
            publishedRevisionId: null,
          }),
          findRevisionById: vi.fn().mockResolvedValue({
            id: publishParams.revisionId,
            entryId: publishParams.entryId,
            revisionNumber: 3,
            content: {
              status: "draft",
              fields: [createDateSnapshot(invalid)],
            },
            status: "draft",
            createdBy: publishParams.actorId,
            createdAt: "2025-09-20T00:00:00.000Z",
            publishedAt: null,
          }),
        });

        await expect(
          publishEntryRevision(deps, publishParams),
        ).rejects.toBeInstanceOf(EntryFieldValidationError);

        expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
        expect(deps.repo.updateEntry).not.toHaveBeenCalled();
      },
    );

    it("throws when revision is missing", async () => {
      const deps = baseDeps({
        findRevisionById: vi.fn().mockResolvedValue(null),
      });

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toBeInstanceOf(EntryRevisionNotFoundError);
    });

    it("rejects relation targets from disallowed models during publish", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 1,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_author",
                locale: "en",
                type: "relation",
                valueString: null,
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: {
                  type: "many",
                  entryIds: ["entry_product"],
                },
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            {
              id: "field_author",
              modelId: defaultModel.id,
              name: "author",
              type: "relation",
              hasLocales: false,
              required: false,
              isPrivate: false,
              isUnique: false,
              variant: "many",
              options: { allowedModels: ["model_authors"] },
            },
          ],
        }),
        findEntriesByIds: vi
          .fn()
          .mockResolvedValue([
            { id: "entry_product", modelId: "model_products" },
          ]),
      });

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toBeInstanceOf(EntryFieldValidationError);

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("throws when unique field conflicts during publish", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 1,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Draft Title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            { ...defaultFields[0], isUnique: true },
            defaultFields[1],
            defaultFields[2],
          ],
        }),
        findUniqueFieldConflict: vi
          .fn()
          .mockResolvedValue({ entryId: "entry_conflict" }),
      });

      await expect(
        publishEntryRevision(deps, {
          actorId: publishParams.actorId,
          entryId: publishParams.entryId,
          modelId: publishParams.modelId,
          revisionId: publishParams.revisionId,
        }),
      ).rejects.toBeInstanceOf(UniqueFieldConflictError);
      expect(deps.runAtomicWrite).not.toHaveBeenCalled();
    });

    it("throws when the revision contains an unconfigured locale", async () => {
      const deps = baseDeps({
        localeExists: vi.fn().mockResolvedValue(false),
        findEntryById: vi.fn().mockResolvedValue({
          id: publishParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: publishParams.revisionId,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: publishParams.revisionId,
          entryId: publishParams.entryId,
          revisionNumber: 1,
          content: {
            status: "draft",
            fields: [
              {
                fieldId: "field_title",
                locale: "fr",
                type: "text",
                valueString: "Bonjour",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "draft",
          createdBy: publishParams.actorId,
          createdAt: "2025-09-20T00:00:00.000Z",
          publishedAt: null,
        }),
      });

      await expect(
        publishEntryRevision(deps, publishParams),
      ).rejects.toBeInstanceOf(EntryLocaleNotFoundError);

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
    });
  });

  describe("bulkPublishEntries", () => {
    const bulkParams: BulkPublishEntriesParams = {
      actorId: "user_publisher",
      modelId: defaultModel.id,
      entryIds: ["entry_a", "entry_b"],
    };

    const entryRecord = (id: string, revisionId: string) => ({
      id,
      modelId: defaultModel.id,
      status: "draft" as const,
      createdAt: "2025-09-20T00:00:00.000Z",
      updatedAt: "2025-09-20T00:00:00.000Z",
      publishedAt: null,
      currentDraftRevisionId: revisionId,
      publishedRevisionId: null,
    });

    const revisionRecord = (
      entryId: string,
      revisionId: string,
      fields: Array<{
        fieldId: string;
        locale: string;
        type: "text" | "list" | "boolean" | "json";
        valueString?: string | null;
        valueBoolean?: boolean | null;
        valueJson?: unknown;
      }>,
    ) => ({
      id: revisionId,
      entryId,
      revisionNumber: 1,
      content: {
        status: "draft" as const,
        fields: fields.map((field) => ({
          fieldId: field.fieldId,
          locale: field.locale,
          type: field.type,
          valueString: field.valueString ?? null,
          valueNumber: null,
          valueDate: null,
          valueBoolean: field.valueBoolean ?? null,
          valueJson: field.valueJson ?? null,
          valueMedia: null,
          valueRelation: null,
        })),
      },
      status: "draft" as const,
      createdBy: bulkParams.actorId,
      createdAt: "2025-09-20T00:00:00.000Z",
      publishedAt: null,
    });

    const bulkDeps = (
      revisions: ReturnType<typeof revisionRecord>[],
      repoOverrides: RepoOverrides = {},
    ) => {
      const entriesById = new Map(
        revisions.map((revision) => [
          revision.entryId,
          entryRecord(revision.entryId, revision.id),
        ]),
      );
      const revisionsById = new Map(
        revisions.map((revision) => [revision.id, revision]),
      );

      return baseDeps({
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [
            { ...defaultFields[0], isUnique: true },
            defaultFields[1],
            defaultFields[2],
          ],
        }),
        findEntryById: vi
          .fn()
          .mockImplementation((entryId: string) =>
            Promise.resolve(entriesById.get(entryId) ?? null),
          ),
        findRevisionById: vi
          .fn()
          .mockImplementation((revisionId: string) =>
            Promise.resolve(revisionsById.get(revisionId) ?? null),
          ),
        ...repoOverrides,
      });
    };

    it("rejects the whole publish when a non-localized field has multiple locale snapshots", async () => {
      const deps = bulkDeps([
        revisionRecord("entry_a", "revision_a", [
          {
            fieldId: "field_title",
            locale: "en",
            type: "text",
            valueString: "Entry A",
          },
          {
            fieldId: "field_featured",
            locale: "en",
            type: "boolean",
            valueBoolean: true,
          },
          {
            fieldId: "field_featured",
            locale: "ja",
            type: "boolean",
            valueBoolean: false,
          },
        ]),
      ]);

      await expect(
        bulkPublishEntries(deps, { ...bulkParams, entryIds: ["entry_a"] }),
      ).rejects.toMatchObject({
        fieldId: "field_featured",
        reason: "non-localized fields cannot contain multiple locale values",
      });

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
      expect(deps.runAtomicWrite).not.toHaveBeenCalled();
    });

    it("rejects the whole publish when a JSON revision violates its schema", async () => {
      const field = createJsonField();
      const deps = bulkDeps(
        [
          revisionRecord("entry_a", "revision_a", [
            {
              fieldId: field.id,
              locale: "en",
              type: "json",
              valueJson: { title: "Valid", meta: { count: 1 } },
            },
          ]),
          revisionRecord("entry_b", "revision_b", [
            {
              fieldId: field.id,
              locale: "en",
              type: "json",
              valueJson: { title: "Invalid", meta: { count: 1.5 } },
            },
          ]),
        ],
        {
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [field],
          }),
        },
      );

      await expect(bulkPublishEntries(deps, bulkParams)).rejects.toMatchObject({
        fieldId: field.id,
        reason: expect.stringContaining("json schema validation failed"),
      });

      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.insertEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("rejects the whole publish when selected entries share a unique value", async () => {
      const deps = bulkDeps([
        revisionRecord("entry_a", "revision_a", [
          {
            fieldId: "field_title",
            locale: "en",
            type: "text",
            valueString: "same-slug",
          },
        ]),
        revisionRecord("entry_b", "revision_b", [
          {
            fieldId: "field_title",
            locale: "en",
            type: "text",
            valueString: "same-slug",
          },
        ]),
      ]);

      await expect(bulkPublishEntries(deps, bulkParams)).rejects.toMatchObject({
        conflicts: [
          expect.objectContaining({
            entryId: "entry_b",
            fieldId: "field_title",
            locale: "en",
            conflictingEntryId: "entry_a",
            scope: "selection",
          }),
        ],
      });

      await expect(bulkPublishEntries(deps, bulkParams)).rejects.toBeInstanceOf(
        BulkUniqueFieldConflictError,
      );
      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
      expect(deps.runAtomicWrite).not.toHaveBeenCalled();
    });

    it("allows the same unique value in different locales", async () => {
      const deps = bulkDeps([
        revisionRecord("entry_a", "revision_a", [
          {
            fieldId: "field_title",
            locale: "en",
            type: "text",
            valueString: "same-slug",
          },
        ]),
        revisionRecord("entry_b", "revision_b", [
          {
            fieldId: "field_title",
            locale: "en",
            type: "text",
            valueString: "other-slug",
          },
          {
            fieldId: "field_title",
            locale: "ja",
            type: "text",
            valueString: "same-slug",
          },
        ]),
      ]);
      vi.mocked(deps.generateId as Mock)
        .mockReturnValueOnce("entry_field_a")
        .mockReturnValueOnce("entry_field_b_en")
        .mockReturnValueOnce("entry_field_b_ja");

      const updated = await bulkPublishEntries(deps, bulkParams);

      expect(updated).toHaveLength(2);
      expect(deps.repo.findUniqueFieldConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldId: "field_title",
          locale: "en",
          excludeEntryIds: ["entry_a", "entry_b"],
        }),
      );
      expect(deps.repo.findUniqueFieldConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldId: "field_title",
          locale: "ja",
          excludeEntryIds: ["entry_a", "entry_b"],
        }),
      );
      expect(deps.repo.updateEntry).toHaveBeenCalledTimes(2);
      expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
    });

    it("rejects the whole publish when a selected entry conflicts with an existing published value", async () => {
      const deps = bulkDeps(
        [
          revisionRecord("entry_a", "revision_a", [
            {
              fieldId: "field_title",
              locale: "en",
              type: "text",
              valueString: "used-slug",
            },
          ]),
        ],
        {
          findUniqueFieldConflict: vi
            .fn()
            .mockResolvedValue({ entryId: "entry_live" }),
        },
      );

      await expect(
        bulkPublishEntries(deps, { ...bulkParams, entryIds: ["entry_a"] }),
      ).rejects.toMatchObject({
        conflicts: [
          expect.objectContaining({
            entryId: "entry_a",
            fieldId: "field_title",
            locale: "en",
            conflictingEntryId: "entry_live",
            scope: "published",
          }),
        ],
      });

      expect(deps.repo.findUniqueFieldConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeEntryIds: ["entry_a"],
        }),
      );
      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("uses complete list value equality, including order", async () => {
      const fieldTags = {
        ...defaultFields[0],
        id: "field_tags",
        name: "tags",
        type: "list" as const,
        isUnique: true,
        required: false,
        options: { item: { type: "text" } },
      };
      const deps = bulkDeps(
        [
          revisionRecord("entry_a", "revision_a", [
            {
              fieldId: "field_tags",
              locale: "en",
              type: "list",
              valueJson: ["a", "b"],
            },
          ]),
          revisionRecord("entry_b", "revision_b", [
            {
              fieldId: "field_tags",
              locale: "en",
              type: "list",
              valueJson: ["b", "a"],
            },
          ]),
        ],
        {
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [fieldTags, defaultFields[1], defaultFields[2]],
          }),
        },
      );
      vi.mocked(deps.generateId as Mock)
        .mockReturnValueOnce("entry_field_a")
        .mockReturnValueOnce("entry_field_b");

      await expect(bulkPublishEntries(deps, bulkParams)).resolves.toHaveLength(
        2,
      );
      expect(deps.repo.updateEntry).toHaveBeenCalledTimes(2);
    });

    it("does not treat empty unique values as conflicts", async () => {
      const deps = bulkDeps(
        [
          revisionRecord("entry_a", "revision_a", [
            {
              fieldId: "field_title",
              locale: "en",
              type: "text",
              valueString: "",
            },
          ]),
          revisionRecord("entry_b", "revision_b", [
            {
              fieldId: "field_title",
              locale: "en",
              type: "text",
              valueString: " ",
            },
          ]),
        ],
        {
          findModelWithFields: vi.fn().mockResolvedValue({
            model: defaultModel,
            fields: [{ ...defaultFields[0], required: false }],
          }),
        },
      );

      await expect(bulkPublishEntries(deps, bulkParams)).resolves.toHaveLength(
        2,
      );
      expect(deps.repo.findUniqueFieldConflict).not.toHaveBeenCalled();
    });

    it("rejects a legal 50-entry selection before it can exceed the D1 query budget", async () => {
      const fieldCount = 92;
      const entryCount = 50;
      const fields = Array.from({ length: fieldCount }, (_, index) => ({
        ...defaultFields[0],
        id: `field_budget_${index}`,
        name: `budget_${index}`,
        required: false,
        isUnique: false,
      }));
      const revisions = Array.from({ length: entryCount }, (_, entryIndex) =>
        revisionRecord(
          `entry_budget_${entryIndex}`,
          `revision_budget_${entryIndex}`,
          fields.map((field, fieldIndex) => ({
            fieldId: field.id,
            locale: "en",
            type: "text" as const,
            valueString: `value-${entryIndex}-${fieldIndex}`,
          })),
        ),
      );
      const deps = bulkDeps(revisions, {
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields,
        }),
      });

      await expect(
        bulkPublishEntries(deps, {
          ...bulkParams,
          entryIds: revisions.map(({ entryId }) => entryId),
        }),
      ).rejects.toMatchObject({
        estimatedQueries: expect.any(Number),
        maxQueries: expect.any(Number),
      });
      await expect(
        bulkPublishEntries(deps, {
          ...bulkParams,
          entryIds: revisions.map(({ entryId }) => entryId),
        }),
      ).rejects.toBeInstanceOf(EntryQueryBudgetExceededError);
      expect(deps.runAtomicWrite).not.toHaveBeenCalled();
      expect(deps.repo.findUniqueFieldConflict).not.toHaveBeenCalled();
    });
  });

  describe("unpublishEntry", () => {
    it("records revision, projection, entry, and audit writes in one unit", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: "entry_published",
          modelId: defaultModel.id,
          status: "published",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-21T00:00:00.000Z",
          publishedAt: "2025-09-21T00:00:00.000Z",
          currentDraftRevisionId: null,
          publishedRevisionId: "revision_published",
        }),
      });

      const updated = await unpublishEntry(deps, {
        actorId: "user_publisher",
        entryId: "entry_published",
        modelId: defaultModel.id,
      });

      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        "revision_published",
        { status: "draft" },
      );
      expect(deps.repo.deleteEntryFields).toHaveBeenCalledWith(
        "entry_published",
      );
      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        "entry_published",
        expect.objectContaining({
          status: "draft",
          currentDraftRevisionId: "revision_published",
          publishedRevisionId: null,
        }),
      );
      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "unpublish" }),
      );
      expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
      expect(updated.status).toBe("draft");
    });
  });

  describe("restoreEntryRevision", () => {
    const restoreParams: RestoreEntryRevisionParams = {
      actorId: "user_editor",
      entryId: "entry_restore",
      modelId: defaultModel.id,
      revisionId: "revision_history",
    };

    it("creates a new draft revision from history without changing published content", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: restoreParams.entryId,
          modelId: defaultModel.id,
          status: "published",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-21T00:00:00.000Z",
          publishedAt: "2025-09-22T00:00:00.000Z",
          currentDraftRevisionId: "revision_current_draft",
          publishedRevisionId: "revision_live",
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: restoreParams.revisionId,
          entryId: restoreParams.entryId,
          revisionNumber: 2,
          content: {
            status: "published",
            fields: [
              {
                fieldId: "field_title",
                locale: "en",
                type: "text",
                valueString: "Older title",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "archived",
          createdBy: "user_editor",
          createdAt: "2025-09-19T00:00:00.000Z",
          publishedAt: "2025-09-20T00:00:00.000Z",
        }),
        getNextRevisionNumber: vi.fn().mockResolvedValue(5),
      });
      vi.mocked(deps.generateId as Mock).mockReturnValueOnce(
        "revision_restored_draft",
      );

      const updated = await restoreEntryRevision(deps, restoreParams);

      expect(deps.repo.updateEntryRevision).toHaveBeenCalledWith(
        "revision_current_draft",
        { status: "archived" },
      );
      expect(deps.repo.insertEntryRevision).toHaveBeenCalledWith({
        id: "revision_restored_draft",
        entryId: restoreParams.entryId,
        revisionNumber: 5,
        content: {
          status: "draft",
          fields: [
            expect.objectContaining({
              fieldId: "field_title",
              valueString: "Older title",
            }),
          ],
        },
        status: "draft",
        createdBy: restoreParams.actorId,
        createdAt: "2025-09-26T12:00:00.000Z",
        publishedAt: null,
      });
      expect(deps.repo.deleteEntryFields).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).toHaveBeenCalledWith(
        restoreParams.entryId,
        {
          status: "published",
          updatedAt: "2025-09-26T12:00:00.000Z",
          publishedAt: "2025-09-22T00:00:00.000Z",
          updatedBy: restoreParams.actorId,
          currentDraftRevisionId: "revision_restored_draft",
          publishedRevisionId: "revision_live",
        },
      );
      expect(updated).toEqual({
        id: restoreParams.entryId,
        modelId: restoreParams.modelId,
        status: "published",
        createdAt: "2025-09-20T00:00:00.000Z",
        updatedAt: "2025-09-26T12:00:00.000Z",
        publishedAt: "2025-09-22T00:00:00.000Z",
      });
      expect(deps.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "restore_revision",
          targetId: restoreParams.entryId,
        }),
      );
      expect(deps.runAtomicWrite).toHaveBeenCalledTimes(1);
    });

    it("throws when the historical revision is missing", async () => {
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: restoreParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-21T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: null,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue(null),
      });

      await expect(
        restoreEntryRevision(deps, restoreParams),
      ).rejects.toBeInstanceOf(EntryRevisionNotFoundError);
    });

    it("rejects restoring a historical JSON value that violates its schema", async () => {
      const field = createJsonField();
      const deps = baseDeps({
        findEntryById: vi.fn().mockResolvedValue({
          id: restoreParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-21T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: null,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: restoreParams.revisionId,
          entryId: restoreParams.entryId,
          revisionNumber: 2,
          content: {
            status: "published",
            fields: [
              createJsonSnapshot({
                title: "Historical",
                meta: { count: 1.5 },
              }),
            ],
          },
          status: "archived",
          createdBy: restoreParams.actorId,
          createdAt: "2025-09-19T00:00:00.000Z",
          publishedAt: "2025-09-20T00:00:00.000Z",
        }),
        findModelWithFields: vi.fn().mockResolvedValue({
          model: defaultModel,
          fields: [field],
        }),
      });

      await expect(
        restoreEntryRevision(deps, restoreParams),
      ).rejects.toMatchObject({
        fieldId: field.id,
        reason: expect.stringContaining("json schema validation failed"),
      });

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });

    it("throws when the historical revision contains an unconfigured locale", async () => {
      const deps = baseDeps({
        localeExists: vi.fn().mockResolvedValue(false),
        findEntryById: vi.fn().mockResolvedValue({
          id: restoreParams.entryId,
          modelId: defaultModel.id,
          status: "draft",
          createdAt: "2025-09-20T00:00:00.000Z",
          updatedAt: "2025-09-21T00:00:00.000Z",
          publishedAt: null,
          currentDraftRevisionId: null,
          publishedRevisionId: null,
        }),
        findRevisionById: vi.fn().mockResolvedValue({
          id: restoreParams.revisionId,
          entryId: restoreParams.entryId,
          revisionNumber: 2,
          content: {
            status: "published",
            fields: [
              {
                fieldId: "field_title",
                locale: "fr",
                type: "text",
                valueString: "Bonjour",
                valueNumber: null,
                valueDate: null,
                valueBoolean: null,
                valueJson: null,
                valueMedia: null,
                valueRelation: null,
              },
            ],
          },
          status: "archived",
          createdBy: "user_editor",
          createdAt: "2025-09-19T00:00:00.000Z",
          publishedAt: "2025-09-20T00:00:00.000Z",
        }),
      });

      await expect(
        restoreEntryRevision(deps, restoreParams),
      ).rejects.toBeInstanceOf(EntryLocaleNotFoundError);

      expect(deps.repo.insertEntryRevision).not.toHaveBeenCalled();
      expect(deps.repo.updateEntry).not.toHaveBeenCalled();
    });
  });
});
