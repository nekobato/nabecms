import { ref, toRaw, type Ref } from "vue";
import type { Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { validateJsonFieldValue } from "@nekobato/nabecms-core/contracts";
import type { ModelField } from "@/modules/entries";

type JsonValidationResult = {
  value: unknown | null;
  error: string | null;
};

type I18nTranslate = (key: string, params?: Record<string, unknown>) => string;

export type UseEntryJsonValidationOptions = {
  fields: Ref<ModelField[]>;
  t: I18nTranslate;
};

export type UseEntryJsonValidationResult = {
  jsonErrors: Ref<Map<string, string>>;
  resetJsonErrors: () => void;
  buildJsonExtensions: (field: ModelField) => Promise<Extension[]>;
  handleJsonChange: (field: ModelField, locale: string | undefined, next: string, onChange: (val: unknown) => void) => void;
  getJsonError: (field: ModelField, locale: string | undefined) => string | null;
  normalizeJsonValues: (values: Record<string, unknown>) => { values: Record<string, unknown>; hasErrors: boolean };
};

/** Narrow unknown values to a plain record. */
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Build a stable key for JSON error tracking. */
const jsonErrorKey = (field: ModelField, locale?: string): string => (locale ? `${field.name}.${locale}` : field.name);

/** Build a JSON validation composable for entry fields. */
export const useEntryJsonValidation = (options: UseEntryJsonValidationOptions): UseEntryJsonValidationResult => {
  const { t, fields } = options;
  const jsonErrors = ref(new Map<string, string>());

  /** Reset JSON error state to a clean slate. */
  const resetJsonErrors = () => {
    jsonErrors.value = new Map();
  };

  /** Validate a JSON input string or value and return parsed value plus any error. */
  const validateJsonInput = (field: ModelField, raw: unknown): JsonValidationResult => {
    let parsed: unknown;
    if (raw === null || raw === undefined || raw === "") {
      parsed = raw;
    } else {
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return { value: null, error: t("contents.edit.json_invalid") };
      }
    }

    const fieldOptions = isRecord(field.options) ? field.options : {};
    const value = typeof parsed === "object" && parsed !== null ? toRaw(parsed) : parsed;
    const result = validateJsonFieldValue(fieldOptions.schema, fieldOptions.stripUnknown === true, value);
    return result.valid
      ? { value: result.value, error: null }
      : {
          value: parsed,
          error: t("contents.edit.json_schema_invalid", {
            detail: result.error,
          }),
        };
  };

  /** Update the local JSON error map with the latest validation result. */
  const setJsonError = (field: ModelField, locale: string | undefined, error: string | null) => {
    const key = jsonErrorKey(field, locale);
    const next = new Map(jsonErrors.value);
    if (error) {
      next.set(key, error);
    } else {
      next.delete(key);
    }
    jsonErrors.value = next;
  };

  /** Resolve an inline JSON error message for a given field/locale pair. */
  const getJsonError = (field: ModelField, locale: string | undefined): string | null => {
    const key = jsonErrorKey(field, locale);
    return jsonErrors.value.get(key) ?? null;
  };

  /** Build CodeMirror extensions for JSON editing and validation. */
  const buildJsonExtensions = async (field: ModelField): Promise<Extension[]> => {
    const [{ json, jsonParseLinter }, { lintGutter, linter }, { EditorView }] = await Promise.all([
      import("@codemirror/lang-json"),
      import("@codemirror/lint"),
      import("@codemirror/view"),
    ]);
    const extensions: Extension[] = [EditorView.lineWrapping, json(), lintGutter(), linter(jsonParseLinter())];

    const schemaLinter = linter((view): Diagnostic[] => {
      const text = view.state.doc.toString();
      const result = validateJsonInput(field, text);
      if (!result.error || result.error === t("contents.edit.json_invalid")) return [];
      const to = Math.min(view.state.doc.length, 1);
      return [
        {
          from: 0,
          to,
          severity: "error",
          message: result.error,
        },
      ];
    });

    return [...extensions, schemaLinter];
  };

  /** React to JSON editor changes, updating validation state and form values. */
  const handleJsonChange = (field: ModelField, locale: string | undefined, next: string, onChange: (val: unknown) => void) => {
    const result = validateJsonInput(field, next);
    setJsonError(field, locale, result.error);
    onChange(next);
  };

  /** Normalize any JSON fields into parsed values before submit. */
  const normalizeJsonValues = (values: Record<string, unknown>): { values: Record<string, unknown>; hasErrors: boolean } => {
    const nextValues: Record<string, unknown> = { ...values };
    let hasErrors = false;
    const updatedErrors = new Map(jsonErrors.value);

    fields.value
      .filter((field) => field.type === "json")
      .forEach((field) => {
        if (field.hasLocales) {
          const localized = isRecord(values[field.name]) ? { ...(values[field.name] as Record<string, unknown>) } : {};
          Object.entries(localized).forEach(([localeKey, raw]) => {
            const result = validateJsonInput(field, raw);
            if (result.error) {
              hasErrors = true;
              updatedErrors.set(jsonErrorKey(field, localeKey), result.error);
            } else {
              updatedErrors.delete(jsonErrorKey(field, localeKey));
              localized[localeKey] = result.value;
            }
          });
          nextValues[field.name] = localized;
          return;
        }

        const result = validateJsonInput(field, values[field.name]);
        if (result.error) {
          hasErrors = true;
          updatedErrors.set(jsonErrorKey(field, undefined), result.error);
        } else {
          updatedErrors.delete(jsonErrorKey(field, undefined));
          nextValues[field.name] = result.value;
        }
      });

    jsonErrors.value = updatedErrors;
    return { values: nextValues, hasErrors };
  };

  return {
    jsonErrors,
    resetJsonErrors,
    buildJsonExtensions,
    handleJsonChange,
    getJsonError,
    normalizeJsonValues,
  };
};
