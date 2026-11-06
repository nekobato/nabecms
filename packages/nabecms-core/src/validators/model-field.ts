import { z } from "zod";
import {
  type FieldOptionsMap,
  type FieldType,
  type FieldVariantMap,
  type ListFieldOptions,
  type ListItemDefinition,
  type ModelFieldOptions,
  dateFormats,
  dateVariants,
  fieldTypes,
  mediaVariants,
  numberVariants,
  relationVariants,
  textVariants,
} from "../contracts";

const commonOptionShape = {
  unique: z.boolean().optional(),
  validate: z.unknown().optional(),
} as const;

const textVariantSchema = z.enum(textVariants).optional();
const textOptionsSchema = z
  .object({
    ...commonOptionShape,
  })
  .strict();

const numberVariantSchema = z.enum(numberVariants).optional();
const numberOptionsBaseSchema = z
  .object({
    ...commonOptionShape,
  })
  .strict();

const dateVariantSchema = z.enum(dateVariants).optional();
const dateFormatSchema = z.enum(dateFormats).optional();
const dateOptionsSchema = z
  .object({
    format: dateFormatSchema,
    ...commonOptionShape,
  })
  .strict();

const listItemTypeEnum = z.enum(["text", "number", "date", "boolean"] as const);

const listItemInputSchema = z
  .object({
    type: listItemTypeEnum,
    variant: z.unknown().optional(),
    options: z.unknown().optional(),
  })
  .strict();

const listOptionsBaseSchema = z
  .object({
    item: listItemInputSchema,
    ...commonOptionShape,
  })
  .strict();

const mediaVariantSchema = z.enum(mediaVariants).optional();
const mediaOptionsSchema = z
  .object({
    allowedKinds: z
      .array(z.enum(["image", "video", "audio", "document", "archive"]))
      .optional(),
    ...commonOptionShape,
  })
  .strict();

const jsonOptionsSchema = z
  .object({
    schema: z.unknown().optional(),
    stripUnknown: z.boolean().optional(),
    ...commonOptionShape,
  })
  .strict();

const relationVariantSchema = z.enum(relationVariants);
const relationOptionsSchema = z
  .object({
    allowedModels: z.array(z.string()).nonempty(),
    filter: z.record(z.string(), z.unknown()).optional(),
    onDelete: z.enum(["restrict", "nullify", "cascade"]).optional(),
    ...commonOptionShape,
  })
  .strict();

const booleanOptionsSchema = z
  .object({
    ...commonOptionShape,
  })
  .strict();

const customOptionsSchema = z
  .object({
    customTypeId: z.string().min(1).optional(),
    schema: z.unknown().optional(),
    version: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    ...commonOptionShape,
  })
  .strict();

const customVariantSchema = z.string().min(1).optional();

const fieldKeyPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const fieldKeySchema = z.string().min(1).regex(fieldKeyPattern, {
  message:
    "fieldKey must be snake_case, start with a lowercase letter, and avoid consecutive underscores",
});

const basePayloadSchema = z
  .object({
    name: z.string().min(1),
    fieldKey: fieldKeySchema,
    type: z.enum(fieldTypes),
    position: z.number().int().min(0).optional(),
    index: z.number().int().min(0).optional(),
    required: z.boolean(),
    hasLocales: z.boolean(),
    isUnique: z.boolean().optional(),
    variant: z.unknown().optional(),
    options: z.unknown().optional(),
    defaultValue: z.unknown().optional(),
    isPrivate: z.boolean().optional(),
    isDisplayTitle: z.boolean().optional(),
  })
  .strict();

type VariantOptionResult<TType extends FieldType> = {
  variant: FieldVariantMap[TType] extends string | undefined
    ? string | null
    : null;
  options: FieldOptionsMap[TType] extends ModelFieldOptions
    ? FieldOptionsMap[TType] | null
    : null;
};

const normalizeNullable = <T>(value: T | null | undefined): T | undefined =>
  value === null || value === undefined ? undefined : value;

const disallowListItemOptions = (options: unknown) => {
  if (normalizeNullable(options) !== undefined) {
    throw new Error("list item options are not supported");
  }
};

const disallowListItemVariant = (variant: unknown) => {
  if (normalizeNullable(variant) !== undefined) {
    throw new Error("list item variants are not supported");
  }
};

const parseListItem = (input: unknown): ListItemDefinition => {
  const parsed = listItemInputSchema.parse(input);
  disallowListItemOptions(parsed.options);
  disallowListItemVariant(parsed.variant);

  switch (parsed.type) {
    case "text": {
      return { type: "text" };
    }
    case "number": {
      return { type: "number" };
    }
    case "date": {
      return { type: "date" };
    }
    case "boolean": {
      return { type: "boolean" };
    }
    default: {
      const exhaustive: never = parsed.type;
      throw new Error(`Unsupported list item type ${exhaustive}`);
    }
  }
};

const parseListOptions = (value: unknown): ListFieldOptions => {
  const parsed = listOptionsBaseSchema.parse(value);
  const item = parseListItem(parsed.item);

  const { unique, validate } = parsed;

  return {
    ...(unique !== undefined ? { unique } : {}),
    ...(validate !== undefined ? { validate } : {}),
    item,
  } as ListFieldOptions;
};

const parseVariantAndOptions = <TType extends FieldType>(
  type: TType,
  variantValue: unknown,
  optionsValue: unknown,
): VariantOptionResult<TType> => {
  const variantInput = normalizeNullable(variantValue);
  const optionsInput = normalizeNullable(optionsValue);

  switch (type) {
    case "text": {
      const variant =
        variantInput === undefined
          ? undefined
          : textVariantSchema.parse(variantInput);
      const options =
        optionsInput === undefined
          ? undefined
          : textOptionsSchema.parse(optionsInput);
      return {
        variant: variant ?? null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    case "rich_text": {
      if (variantInput !== undefined) {
        throw new Error("rich_text fields do not support variant");
      }
      if (optionsInput !== undefined) {
        throw new Error("rich_text fields do not support options");
      }
      return { variant: null, options: null } as VariantOptionResult<TType>;
    }
    case "number": {
      const variant =
        variantInput === undefined
          ? undefined
          : numberVariantSchema.parse(variantInput);
      const options =
        optionsInput === undefined
          ? undefined
          : numberOptionsBaseSchema.parse(optionsInput);
      return {
        variant: variant ?? null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    case "date": {
      const variant =
        variantInput === undefined
          ? undefined
          : dateVariantSchema.parse(variantInput);
      const options =
        optionsInput === undefined
          ? undefined
          : dateOptionsSchema.parse(optionsInput);
      const format = options?.format;
      if (format === "date" && variant === "datetime") {
        throw new Error(
          "date format 'date' cannot be used with datetime variant",
        );
      }
      if (
        (format === "datetime" || format === "datetime_with_timezone") &&
        variant === "date"
      ) {
        throw new Error("datetime formats require datetime variant");
      }
      return {
        variant: variant ?? null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    case "list": {
      if (variantInput !== undefined) {
        throw new Error("list fields do not support variant");
      }
      if (optionsInput === undefined) {
        throw new Error("list fields require options.item definition");
      }
      const options = parseListOptions(optionsInput);
      return {
        variant: null,
        options: options as ModelFieldOptions,
      } as VariantOptionResult<TType>;
    }
    case "media": {
      const variant =
        variantInput === undefined
          ? undefined
          : mediaVariantSchema.parse(variantInput);
      const options =
        optionsInput === undefined
          ? undefined
          : mediaOptionsSchema.parse(optionsInput);
      return {
        variant: variant ?? null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    case "json": {
      if (variantInput !== undefined) {
        throw new Error("json fields do not support variant");
      }
      const options =
        optionsInput === undefined
          ? undefined
          : jsonOptionsSchema.parse(optionsInput);
      return {
        variant: null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    case "relation": {
      if (variantInput === undefined) {
        throw new Error("relation fields require variant 'one' or 'many'");
      }
      if (optionsInput === undefined) {
        throw new Error("relation fields require options.allowedModels");
      }
      const variant = relationVariantSchema.parse(variantInput);
      const options = relationOptionsSchema.parse(optionsInput);
      return {
        variant,
        options: options as ModelFieldOptions,
      } as VariantOptionResult<TType>;
    }
    case "boolean": {
      if (variantInput !== undefined) {
        throw new Error("boolean fields do not support variant");
      }
      const options =
        optionsInput === undefined
          ? undefined
          : booleanOptionsSchema.parse(optionsInput);
      return {
        variant: null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    case "custom": {
      const variant =
        variantInput === undefined
          ? undefined
          : customVariantSchema.parse(variantInput);
      const options =
        optionsInput === undefined
          ? undefined
          : customOptionsSchema.parse(optionsInput);
      return {
        variant: variant ?? null,
        options: (options as ModelFieldOptions) ?? null,
      } as VariantOptionResult<TType>;
    }
    default: {
      const exhaustive: never = type;
      throw new Error(
        `Unsupported field type ${(exhaustive as string) ?? "unknown"}`,
      );
    }
  }
};

export type ParsedModelFieldPayload = {
  name: string;
  fieldKey: string;
  type: FieldType;
  position: number | null;
  required: boolean;
  hasLocales: boolean;
  isUnique: boolean;
  variant: string | null;
  options: ModelFieldOptions | null;
  defaultValue: unknown;
  isPrivate: boolean;
  isDisplayTitle: boolean;
};

export const parseModelFieldPayload = (
  input: unknown,
): ParsedModelFieldPayload => {
  const base = basePayloadSchema.parse(input);

  const { variant, options } = parseVariantAndOptions(
    base.type,
    base.variant,
    base.options,
  );

  const position = base.position ?? base.index ?? null;
  if (base.type === "rich_text" && base.isUnique) {
    throw new Error("rich_text fields do not support unique constraint");
  }

  return {
    name: base.name,
    fieldKey: base.fieldKey,
    type: base.type,
    position,
    required: base.required,
    hasLocales: base.hasLocales,
    isUnique: base.isUnique ?? false,
    variant,
    options,
    defaultValue: base.defaultValue ?? null,
    isPrivate: base.isPrivate ?? false,
    isDisplayTitle: base.isDisplayTitle ?? false,
  };
};
