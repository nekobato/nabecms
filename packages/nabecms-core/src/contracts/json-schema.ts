import {
  Validator,
  dereference,
  validate,
  type OutputUnit,
  type Schema,
} from "@cfworker/json-schema";
import { draft7MetaSchema } from "./json-schema-draft7";

/** Result of validating and optionally normalizing a JSON field value. */
export type JsonFieldValidationResult =
  { valid: true; value: unknown } | { valid: false; error: string };

type PreparedJsonSchema = {
  schema: Schema;
  validator: Validator;
  lookup: Record<string, Schema | boolean>;
};

type PreparedJsonSchemaResult =
  | { valid: true; prepared: PreparedJsonSchema }
  | { valid: false; error: string };

type StripNormalizationContext = {
  branchSelectionStack: Set<Schema | boolean>;
};

const draft7MetaValidator = new Validator(draft7MetaSchema, "7", false);
const jsonSchemaCache = new Map<string, PreparedJsonSchema>();
const maxJsonSchemaCacheEntries = 100;
const draft7SchemaUris = new Set([
  "http://json-schema.org/draft-07/schema",
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft-07/schema",
  "https://json-schema.org/draft-07/schema#",
]);
const draft7Keywords = new Set(Object.keys(draft7MetaSchema.properties ?? {}));
const draft7DirectSchemaKeywords = new Set([
  "additionalItems",
  "contains",
  "additionalProperties",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);
const draft7SchemaArrayKeywords = new Set(["allOf", "anyOf", "oneOf"]);
const draft7SchemaMapKeywords = new Set([
  "definitions",
  "properties",
  "patternProperties",
]);

/** Narrow an unknown value to a non-array object. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Narrow an unknown value to a Draft 7 schema value. */
const isSchemaValue = (value: unknown): value is Schema | boolean =>
  typeof value === "boolean" || isRecord(value);

/** Deep-clone a value while isolating object keys from inherited prototypes. */
const createSafeValidationCandidate = (
  value: unknown,
  visited = new WeakMap<object, unknown>(),
): unknown => {
  if (typeof value !== "object" || value === null) return value;

  const existing = visited.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const candidate = new Array<unknown>(value.length);
    visited.set(value, candidate);
    value.forEach((item, index) => {
      candidate[index] = createSafeValidationCandidate(item, visited);
    });
    return candidate;
  }

  const candidate = Object.create(null) as Record<string, unknown>;
  visited.set(value, candidate);
  Object.entries(value).forEach(([key, item]) => {
    candidate[key] = createSafeValidationCandidate(item, visited);
  });
  return candidate;
};

/** Collect schema values from one Draft 7 schema-map keyword. */
const getSchemaMapValues = (value: unknown): Array<Schema | boolean> =>
  isRecord(value) ? Object.values(value).filter(isSchemaValue) : [];

/** Remove unknown Draft 7 annotation keywords before library dereferencing. */
const sanitizeDraft7Schema = (schema: Schema | boolean): Schema | boolean => {
  if (typeof schema === "boolean") return schema;

  const sanitized = Object.create(null) as Record<string, unknown>;
  Object.entries(schema).forEach(([keyword, value]) => {
    if (!draft7Keywords.has(keyword)) return;

    if (keyword === "items") {
      sanitized[keyword] = Array.isArray(value)
        ? value.map((item) =>
            isSchemaValue(item) ? sanitizeDraft7Schema(item) : item,
          )
        : isSchemaValue(value)
          ? sanitizeDraft7Schema(value)
          : value;
      return;
    }

    if (draft7DirectSchemaKeywords.has(keyword)) {
      sanitized[keyword] = isSchemaValue(value)
        ? sanitizeDraft7Schema(value)
        : value;
      return;
    }

    if (draft7SchemaArrayKeywords.has(keyword)) {
      sanitized[keyword] = Array.isArray(value)
        ? value.map((item) =>
            isSchemaValue(item) ? sanitizeDraft7Schema(item) : item,
          )
        : value;
      return;
    }

    if (draft7SchemaMapKeywords.has(keyword) || keyword === "dependencies") {
      if (!isRecord(value)) {
        sanitized[keyword] = value;
        return;
      }

      const sanitizedMap = Object.create(null) as Record<string, unknown>;
      Object.entries(value).forEach(([name, child]) => {
        sanitizedMap[name] = isSchemaValue(child)
          ? sanitizeDraft7Schema(child)
          : child;
      });
      sanitized[keyword] = sanitizedMap;
      return;
    }

    sanitized[keyword] = value;
  });
  return sanitized as Schema;
};

/** Format validator output consistently for Core and Admin consumers. */
const formatValidationError = (error: OutputUnit): string => {
  const path =
    error.instanceLocation === "#"
      ? "/"
      : error.instanceLocation.replace(/^#/u, "");
  return `${path} ${error.error}`;
};

/** Format a list of validation failures as one deterministic detail string. */
const formatValidationErrors = (errors: OutputUnit[]): string =>
  errors.map(formatValidationError).join("; ");

/** Serialize a schema without silently accepting non-JSON values. */
const serializeSchema = (schema: Record<string, unknown>): string =>
  JSON.stringify(schema, (_key, value: unknown) => {
    if (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      (typeof value === "number" && !Number.isFinite(value))
    ) {
      throw new TypeError("Schema contains a non-JSON value");
    }
    return value;
  });

/** Cache a prepared schema while bounding isolate-wide memory use. */
const cachePreparedSchema = (
  serializedSchema: string,
  prepared: PreparedJsonSchema,
): void => {
  if (jsonSchemaCache.size >= maxJsonSchemaCacheEntries) {
    const oldestKey = jsonSchemaCache.keys().next().value;
    if (typeof oldestKey === "string") jsonSchemaCache.delete(oldestKey);
  }
  jsonSchemaCache.set(serializedSchema, prepared);
};

/** Find an unresolved reference in Draft 7 schema locations. */
const findUnresolvedReference = (
  schema: Schema | boolean,
  lookup: Record<string, Schema | boolean>,
  visited = new Set<Schema | boolean>(),
): string | null => {
  if (typeof schema === "boolean" || visited.has(schema)) return null;
  visited.add(schema);

  if (typeof schema.$ref === "string") {
    const absoluteReference = schema.__absolute_ref__;
    const referenced =
      typeof absoluteReference === "string" &&
      Object.hasOwn(lookup, absoluteReference)
        ? lookup[absoluteReference]
        : undefined;
    if (referenced === undefined) return schema.$ref;
    return findUnresolvedReference(referenced, lookup, visited);
  }

  const directSchemas: Array<Schema | boolean | undefined> = [
    schema.additionalItems,
    Array.isArray(schema.items) ? undefined : schema.items,
    schema.contains,
    schema.additionalProperties,
    schema.propertyNames,
    schema.not,
    schema.if,
    schema.then,
    schema.else,
  ];
  const arraySchemas: Array<Schema | boolean> = [
    ...(Array.isArray(schema.items) ? schema.items : []),
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
  ];
  const mapSchemas: Array<Schema | boolean> = [
    ...getSchemaMapValues(schema.definitions),
    ...getSchemaMapValues(schema.properties),
    ...getSchemaMapValues(schema.patternProperties),
    ...getSchemaMapValues(schema.dependencies),
  ];

  for (const childSchema of [
    ...directSchemas,
    ...arraySchemas,
    ...mapSchemas,
  ]) {
    if (childSchema === undefined) continue;
    const unresolved = findUnresolvedReference(childSchema, lookup, visited);
    if (unresolved) return unresolved;
  }

  return null;
};

/** Parse, meta-validate, dereference, and cache a Draft 7 schema. */
const prepareJsonSchema = (candidate: unknown): PreparedJsonSchemaResult => {
  let parsedCandidate = candidate;
  if (typeof candidate === "string") {
    try {
      parsedCandidate = JSON.parse(candidate) as unknown;
    } catch {
      return {
        valid: false,
        error: "json schema is invalid: expected a JSON object",
      };
    }
  }

  if (!isRecord(parsedCandidate)) {
    return {
      valid: false,
      error: "json schema is invalid: expected a JSON object",
    };
  }

  let serializedSchema: string;
  try {
    serializedSchema = serializeSchema(parsedCandidate);
  } catch {
    return {
      valid: false,
      error: "json schema is invalid: expected a serializable JSON object",
    };
  }

  const cached = jsonSchemaCache.get(serializedSchema);
  if (cached) return { valid: true, prepared: cached };

  const parsedSchema = JSON.parse(serializedSchema) as Schema;
  if (
    typeof parsedSchema.$schema === "string" &&
    !draft7SchemaUris.has(parsedSchema.$schema)
  ) {
    return {
      valid: false,
      error: "json schema is invalid: only JSON Schema Draft 7 is supported",
    };
  }
  const metaValidation = draft7MetaValidator.validate(
    createSafeValidationCandidate(parsedSchema),
  );
  if (!metaValidation.valid) {
    const detail = formatValidationErrors(metaValidation.errors);
    return {
      valid: false,
      error: `json schema is invalid${detail ? `: ${detail}` : ""}`,
    };
  }

  try {
    const schema = sanitizeDraft7Schema(parsedSchema) as Schema;
    const lookup = dereference(schema);
    const unresolvedReference = findUnresolvedReference(schema, lookup);
    if (unresolvedReference) {
      return {
        valid: false,
        error: `json schema is invalid: unresolved $ref ${unresolvedReference}`,
      };
    }

    const prepared = {
      schema,
      validator: new Validator(schema, "7", false),
      lookup,
    };
    cachePreparedSchema(serializedSchema, prepared);
    return { valid: true, prepared };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    return { valid: false, error: `json schema is invalid${detail}` };
  }
};

/** Resolve a referenced schema from the validator's dereference lookup. */
const resolveReference = (
  schema: Schema,
  prepared: PreparedJsonSchema,
): Schema | boolean | null => {
  if (typeof schema.$ref !== "string") return null;
  const absoluteReference = schema.__absolute_ref__;
  return typeof absoluteReference === "string" &&
    Object.hasOwn(prepared.lookup, absoluteReference)
    ? (prepared.lookup[absoluteReference] ?? null)
    : null;
};

/** Return whether an instance validates against one prepared subschema. */
const matchesSchema = (
  instance: unknown,
  schema: Schema | boolean,
  prepared: PreparedJsonSchema,
): boolean => {
  try {
    return validate(
      createSafeValidationCandidate(instance),
      schema,
      "7",
      prepared.lookup,
      true,
    ).valid;
  } catch {
    return false;
  }
};

/** Build one neutral branch-selection candidate from all sibling schemas. */
function createNeutralBranchCandidate(
  instance: unknown,
  schemas: Array<Schema | boolean>,
  prepared: PreparedJsonSchema,
  context: StripNormalizationContext,
): unknown {
  let candidate: unknown;
  try {
    candidate = structuredClone(instance);
  } catch {
    return instance;
  }

  const selectableSchemas = schemas.filter(
    (schema) => !context.branchSelectionStack.has(schema),
  );
  if (selectableSchemas.length === 0) return candidate;

  selectableSchemas.forEach((schema) =>
    context.branchSelectionStack.add(schema),
  );
  try {
    stripSchemaExternalKeys(candidate, schemas, prepared, context);
    return candidate;
  } finally {
    selectableSchemas.forEach((schema) =>
      context.branchSelectionStack.delete(schema),
    );
  }
}

/** Select matching alternatives without allowing one branch to erase sibling keys. */
const selectApplicableBranches = (
  instance: unknown,
  branches: Array<Schema | boolean>,
  prepared: PreparedJsonSchema,
  context: StripNormalizationContext,
): Array<Schema | boolean> => {
  const candidate = createNeutralBranchCandidate(
    instance,
    branches,
    prepared,
    context,
  );
  const matchingBranches = branches.filter((branch) =>
    matchesSchema(candidate, branch, prepared),
  );

  // Preserve every branch declaration when the value is invalid. The final
  // schema validation will reject it without first deleting the evidence.
  return matchingBranches.length > 0 ? matchingBranches : branches;
};

/** Expand structural schemas that apply to the current instance. */
const expandApplicableSchemas = (
  schema: Schema | boolean,
  instance: unknown,
  prepared: PreparedJsonSchema,
  visited: Set<Schema | boolean>,
  context: StripNormalizationContext,
): Schema[] => {
  if (typeof schema === "boolean" || visited.has(schema)) return [];
  visited.add(schema);

  if (typeof schema.$ref === "string") {
    const referenced = resolveReference(schema, prepared);
    return referenced === null
      ? []
      : expandApplicableSchemas(
          referenced,
          instance,
          prepared,
          visited,
          context,
        );
  }

  const expanded = [schema];
  for (const branch of schema.allOf ?? []) {
    expanded.push(
      ...expandApplicableSchemas(branch, instance, prepared, visited, context),
    );
  }

  for (const branch of selectApplicableBranches(
    instance,
    schema.anyOf ?? [],
    prepared,
    context,
  )) {
    expanded.push(
      ...expandApplicableSchemas(branch, instance, prepared, visited, context),
    );
  }

  for (const branch of selectApplicableBranches(
    instance,
    schema.oneOf ?? [],
    prepared,
    context,
  )) {
    expanded.push(
      ...expandApplicableSchemas(branch, instance, prepared, visited, context),
    );
  }

  const conditionalSchema = schema.if as Schema | boolean | undefined;
  const thenSchema = schema.then as Schema | boolean | undefined;
  const elseSchema = schema.else as Schema | boolean | undefined;
  if (conditionalSchema !== undefined) {
    const conditionalSchemas: Array<Schema | boolean> = [
      conditionalSchema,
      thenSchema,
      elseSchema,
    ].filter(
      (candidate): candidate is Schema | boolean => candidate !== undefined,
    );
    const conditionalCandidate = createNeutralBranchCandidate(
      instance,
      conditionalSchemas,
      prepared,
      context,
    );
    expanded.push(
      ...expandApplicableSchemas(
        conditionalSchema,
        conditionalCandidate,
        prepared,
        visited,
        context,
      ),
    );
    const conditionalBranch = matchesSchema(
      conditionalCandidate,
      conditionalSchema,
      prepared,
    )
      ? thenSchema
      : elseSchema;
    if (conditionalBranch !== undefined) {
      expanded.push(
        ...expandApplicableSchemas(
          conditionalBranch,
          instance,
          prepared,
          visited,
          context,
        ),
      );
    }
  }

  if (isRecord(instance) && isRecord(schema.dependencies)) {
    for (const [propertyName, dependency] of Object.entries(
      schema.dependencies,
    )) {
      if (
        !Object.hasOwn(instance, propertyName) ||
        !isSchemaValue(dependency)
      ) {
        continue;
      }
      expanded.push(
        ...expandApplicableSchemas(
          dependency,
          instance,
          prepared,
          visited,
          context,
        ),
      );
    }
  }

  return expanded;
};

/** Select item schemas that apply to one array position in Draft 7. */
const getItemSchemas = (
  schema: Schema,
  index: number,
): Array<Schema | boolean> => {
  if (Array.isArray(schema.items)) {
    if (schema.items[index] !== undefined) return [schema.items[index]];
    return schema.additionalItems === undefined ? [] : [schema.additionalItems];
  }
  return schema.items === undefined ? [] : [schema.items];
};

/** Strip schema-external object keys from a cloned JSON value in place. */
function stripSchemaExternalKeys(
  value: unknown,
  schemas: Array<Schema | boolean>,
  prepared: PreparedJsonSchema,
  context: StripNormalizationContext = {
    branchSelectionStack: new Set(),
  },
): void {
  const applicableSchemas = schemas.flatMap((schema) =>
    expandApplicableSchemas(schema, value, prepared, new Set(), context),
  );

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const itemSchemas = applicableSchemas.flatMap((schema) =>
        getItemSchemas(schema, index),
      );
      if (itemSchemas.length > 0) {
        stripSchemaExternalKeys(item, itemSchemas, prepared, context);
      }
    });
    return;
  }

  if (!isRecord(value)) return;

  Object.keys(value).forEach((key) => {
    const propertySchemas: Array<Schema | boolean> = [];
    let declared = false;

    applicableSchemas.forEach((schema) => {
      if (schema.required?.includes(key)) {
        declared = true;
      }

      if (
        isRecord(schema.properties) &&
        Object.hasOwn(schema.properties, key)
      ) {
        declared = true;
        propertySchemas.push(schema.properties[key]);
      }

      if (isRecord(schema.dependencies)) {
        if (Object.hasOwn(schema.dependencies, key)) {
          declared = true;
        }
        Object.entries(schema.dependencies).forEach(
          ([propertyName, dependency]) => {
            if (
              Object.hasOwn(value, propertyName) &&
              Array.isArray(dependency) &&
              dependency.includes(key)
            ) {
              declared = true;
            }
          },
        );
      }

      Object.entries(schema.patternProperties ?? {}).forEach(
        ([pattern, propertySchema]) => {
          if (new RegExp(pattern, "u").test(key)) {
            declared = true;
            propertySchemas.push(propertySchema);
          }
        },
      );
    });

    if (!declared) {
      delete value[key];
      return;
    }

    if (propertySchemas.length > 0) {
      stripSchemaExternalKeys(value[key], propertySchemas, prepared, context);
    }
  });
}

/**
 * Validate and optionally normalize a JSON field value with Draft 7 semantics.
 *
 * Empty values normalize to null. In strip mode the input is deep-cloned, then
 * keys not selected by `properties` or `patternProperties` are removed at each
 * schema-defined object level before the normalized clone is validated.
 */
export const validateJsonFieldValue = (
  schemaCandidate: unknown,
  stripUnknown: boolean,
  value: unknown,
): JsonFieldValidationResult => {
  if (schemaCandidate === undefined || schemaCandidate === null) {
    if (stripUnknown) {
      return {
        valid: false,
        error: "json stripUnknown requires options.schema",
      };
    }
    return {
      valid: true,
      value:
        value === null || value === undefined || value === "" ? null : value,
    };
  }

  const preparedResult = prepareJsonSchema(schemaCandidate);
  if (!preparedResult.valid) return preparedResult;

  if (value === null || value === undefined || value === "") {
    return { valid: true, value: null };
  }

  let normalizedValue = value;
  if (stripUnknown) {
    try {
      normalizedValue = structuredClone(value);
      stripSchemaExternalKeys(
        normalizedValue,
        [preparedResult.prepared.schema],
        preparedResult.prepared,
      );
    } catch {
      return {
        valid: false,
        error: "json value must be structured-cloneable",
      };
    }
  }

  try {
    const validation = preparedResult.prepared.validator.validate(
      createSafeValidationCandidate(normalizedValue),
    );
    if (validation.valid) return { valid: true, value: normalizedValue };
    const detail = formatValidationErrors(validation.errors);
    return {
      valid: false,
      error: `json schema validation failed${detail ? `: ${detail}` : ""}`,
    };
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    return {
      valid: false,
      error: `json schema validation failed${detail}`,
    };
  }
};
