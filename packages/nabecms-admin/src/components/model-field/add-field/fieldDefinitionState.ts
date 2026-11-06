import { reactive } from "vue";
import type {
  CustomOptionsState,
  DateOptionsState,
  FieldFormState,
  FieldOptionsState,
  ListOptionsState,
  NumberOptionsState,
  RelationOptionsState,
  TextOptionsState,
} from "./types";
import { mediaKindValues } from "./fieldDefinitionCatalog";

/**
 * Creates a fresh reactive options state for the field definition dialog.
 */
export function createOptionsState(): FieldOptionsState {
  const text: TextOptionsState = {};

  const number: NumberOptionsState = {};

  const date: DateOptionsState = {
    format: "date",
  };

  const media: FieldOptionsState["media"] = {
    allowedKinds: [...mediaKindValues],
  };

  const relation: RelationOptionsState = {
    allowedModelIds: [],
  };

  const boolean: FieldOptionsState["boolean"] = {};

  const custom: CustomOptionsState = {
    customTypeId: "",
    version: "",
    schemaText: "",
    configText: "",
  };

  const list: ListOptionsState = {
    itemType: "text",
    text: { ...text },
    number: { ...number },
    date: {},
    boolean: {},
  };

  return reactive({
    text,
    number,
    date,
    media,
    relation,
    boolean,
    custom,
    list,
  }) as FieldOptionsState;
}

/**
 * Deeply copies plain object values into an existing reactive target.
 */
export function deepAssign(target: Record<string, unknown>, source: Record<string, unknown>): void {
  Object.entries(source).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      target[key] = [...value];
      return;
    }

    if (value && typeof value === "object") {
      const targetChild = target[key] && typeof target[key] === "object" ? (target[key] as Record<string, unknown>) : {};
      deepAssign(targetChild, value as Record<string, unknown>);
      target[key] = targetChild;
      return;
    }

    target[key] = value;
  });
}

/**
 * Creates a fresh reactive base form state for field definitions.
 */
export function createFormState(): FieldFormState {
  return reactive({
    name: "",
    fieldKey: "",
    required: false,
    hasLocales: false,
    isUnique: false,
    variant: "",
    defaultValue: null,
    isPrivate: false,
  });
}
