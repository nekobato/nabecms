import {
  InvalidFilterError,
  type FieldFilterOperator,
  type FilterNode,
  type FilterableFieldType,
  type ModelFieldRecord,
} from "./types";

const MAX_FILTER_DEPTH = 6;
const MAX_FILTER_ARRAY_LENGTH = 50;

const filterOperatorsByType: Record<
  FilterableFieldType,
  Set<FieldFilterOperator>
> = {
  text: new Set([
    "$eq",
    "$ne",
    "$in",
    "$notIn",
    "$null",
    "$notNull",
    "$contains",
    "$startsWith",
    "$endsWith",
  ]),
  number: new Set([
    "$eq",
    "$ne",
    "$lt",
    "$lte",
    "$gt",
    "$gte",
    "$in",
    "$notIn",
    "$null",
    "$notNull",
  ]),
  date: new Set([
    "$eq",
    "$ne",
    "$lt",
    "$lte",
    "$gt",
    "$gte",
    "$in",
    "$notIn",
    "$null",
    "$notNull",
  ]),
  boolean: new Set(["$eq", "$ne", "$null", "$notNull"]),
};

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidFilter(path: Array<string | number>, message: string): never {
  throw new InvalidFilterError([{ path, message }]);
}

function normalizeFilterFieldKey(fieldKey: string): string {
  return fieldKey.startsWith("fields.") ? fieldKey.slice(7) : fieldKey;
}

function normalizeIndexedArray(
  value: unknown,
  path: Array<string | number>,
): unknown[] {
  if (Array.isArray(value)) {
    if (value.length > MAX_FILTER_ARRAY_LENGTH) {
      invalidFilter(path, "Filter array is too large");
    }
    return value;
  }
  if (!isRecordObject(value)) {
    invalidFilter(path, "Expected an array value");
  }

  const keys = Object.keys(value);
  if (keys.length > MAX_FILTER_ARRAY_LENGTH) {
    invalidFilter(path, "Filter array is too large");
  }
  if (!keys.every((key) => /^\d+$/.test(key))) {
    invalidFilter(path, "Expected numeric array indexes");
  }

  return keys
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => value[key]);
}

function normalizeTextValue(
  value: unknown,
  path: Array<string | number>,
): string {
  if (typeof value !== "string") {
    invalidFilter(path, "Expected a string value");
  }
  return value;
}

function normalizeNumberValue(
  value: unknown,
  path: Array<string | number>,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  invalidFilter(path, "Expected a numeric value");
}

function normalizeBooleanValue(
  value: unknown,
  path: Array<string | number>,
): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  invalidFilter(path, "Expected a boolean value");
}

function normalizeDateValue(
  value: unknown,
  path: Array<string | number>,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidFilter(path, "Expected an ISO date string");
  }
  return value;
}

function normalizeScalarFilterValue(
  fieldType: FilterableFieldType,
  value: unknown,
  path: Array<string | number>,
): string | number | boolean {
  switch (fieldType) {
    case "text":
      return normalizeTextValue(value, path);
    case "number":
      return normalizeNumberValue(value, path);
    case "date":
      return normalizeDateValue(value, path);
    case "boolean":
      return normalizeBooleanValue(value, path);
  }
}

function normalizeNullOperatorValue(
  value: unknown,
  path: Array<string | number>,
): void {
  if (value === undefined) return;
  if (typeof value === "boolean") {
    if (value) return;
    invalidFilter(path, "Expected true for null checks");
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "" || normalized === "true" || normalized === "1") {
      return;
    }
  }
  invalidFilter(path, "Expected true for null checks");
}

function normalizeFieldFilterLeaf(
  field: ModelFieldRecord,
  operator: string,
  value: unknown,
  path: Array<string | number>,
): FilterNode {
  const fieldType = field.type as FilterableFieldType;
  const allowedOperators = filterOperatorsByType[fieldType];
  if (!allowedOperators) {
    invalidFilter(path, `Field type '${field.type}' does not support filters`);
  }
  if (!allowedOperators.has(operator as FieldFilterOperator)) {
    invalidFilter(
      path,
      `Operator '${operator}' is not supported for ${field.type}`,
    );
  }

  if (operator === "$null" || operator === "$notNull") {
    normalizeNullOperatorValue(value, path);
    return {
      kind: "field",
      fieldKey: field.fieldKey,
      fieldType,
      operator: operator as FieldFilterOperator,
    };
  }

  if (operator === "$in" || operator === "$notIn") {
    const values = normalizeIndexedArray(value, path).map((item, index) =>
      normalizeScalarFilterValue(fieldType, item, [...path, index]),
    );
    return {
      kind: "field",
      fieldKey: field.fieldKey,
      fieldType,
      operator: operator as FieldFilterOperator,
      value: values,
    };
  }

  return {
    kind: "field",
    fieldKey: field.fieldKey,
    fieldType,
    operator: operator as FieldFilterOperator,
    value: normalizeScalarFilterValue(fieldType, value, path),
  };
}

/**
 * Normalize arbitrary filter input into the internal filter AST.
 */
export function normalizeFilterNode(
  raw: unknown,
  fieldMap: ReadonlyMap<string, ModelFieldRecord>,
  path: Array<string | number> = [],
  depth = 0,
): FilterNode | null {
  if (depth > MAX_FILTER_DEPTH) {
    invalidFilter(path, "Filter nesting is too deep");
  }
  if (!isRecordObject(raw)) {
    invalidFilter(path, "filters must be an object");
  }

  const nodes: FilterNode[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (key === "$and" || key === "$or") {
      const items = normalizeIndexedArray(value, [...path, key]);
      if (items.length === 0) {
        invalidFilter([...path, key], `${key} requires at least one condition`);
      }
      nodes.push({
        kind: key === "$and" ? "and" : "or",
        nodes: items.map((item, index) => {
          const child = normalizeFilterNode(
            item,
            fieldMap,
            [...path, key, index],
            depth + 1,
          );
          if (!child) {
            invalidFilter(
              [...path, key, index],
              `${key} condition cannot be empty`,
            );
          }
          return child;
        }),
      });
      continue;
    }

    if (key === "$not") {
      const child = normalizeFilterNode(
        value,
        fieldMap,
        [...path, key],
        depth + 1,
      );
      if (!child) {
        invalidFilter([...path, key], "$not requires a condition");
      }
      nodes.push({ kind: "not", node: child });
      continue;
    }

    const normalizedFieldKey = normalizeFilterFieldKey(key);
    const field = fieldMap.get(normalizedFieldKey);
    if (!field || field.isPrivate) {
      invalidFilter([...path, key], `Unknown filter field '${key}'`);
    }
    if (!filterOperatorsByType[field.type as FilterableFieldType]) {
      invalidFilter(
        [...path, key],
        `Field type '${field.type}' is not supported in filters`,
      );
    }

    const operatorEntries = isRecordObject(value)
      ? Object.entries(value)
      : [["$eq", value] as const];

    if (operatorEntries.length === 0) {
      invalidFilter([...path, key], "Field filters cannot be empty");
    }

    const fieldNodes = operatorEntries.map(([operator, operatorValue]) => {
      if (!operator.startsWith("$")) {
        invalidFilter(
          [...path, key, operator],
          "Filter operators must start with '$'",
        );
      }
      return normalizeFieldFilterLeaf(field, operator, operatorValue, [
        ...path,
        key,
        operator,
      ]);
    });

    nodes.push(
      fieldNodes.length === 1
        ? fieldNodes[0]
        : { kind: "and", nodes: fieldNodes },
    );
  }

  if (nodes.length === 0) return null;
  return nodes.length === 1 ? nodes[0] : { kind: "and", nodes };
}

/**
 * Collect every field key referenced by a filter AST.
 */
export function collectFilterFieldKeys(
  node: FilterNode | null,
  target = new Set<string>(),
): Set<string> {
  if (!node) return target;
  if (node.kind === "field") {
    target.add(node.fieldKey);
    return target;
  }
  if (node.kind === "not") {
    return collectFilterFieldKeys(node.node, target);
  }
  for (const child of node.nodes) {
    collectFilterFieldKeys(child, target);
  }
  return target;
}
