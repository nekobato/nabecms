import { defineRule, configure } from "vee-validate";
import { required, email, min, max } from "@vee-validate/rules";
import { localize, setLocale as setVeeLocale } from "@vee-validate/i18n";
import en from "@vee-validate/i18n/dist/locale/en.json";
import ja from "@vee-validate/i18n/dist/locale/ja.json";

type RichTextElement = {
  type?: string;
  text?: string;
  content?: RichTextNode[];
};

type RichTextNode = string | RichTextElement | RichTextNode[];

type RichTextPayload = {
  type: "rich_text";
  value: RichTextNode;
};

const isRichTextNode = (node: unknown): node is RichTextNode => {
  if (typeof node === "string") return true;
  if (Array.isArray(node)) return node.every((item) => isRichTextNode(item));
  if (typeof node === "object" && node !== null) {
    const candidate = node as Record<string, unknown>;
    const text = candidate.text;
    const content = candidate.content;
    const textValid = text === undefined || typeof text === "string";
    const contentValid = content === undefined || (Array.isArray(content) && content.every((item) => isRichTextNode(item)));
    return textValid && contentValid;
  }
  return false;
};

type RelationPayload = {
  entryIds?: unknown;
};

const hasRelationEntries = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((item) => {
      if (typeof item === "string") return item.trim().length > 0;
      if (typeof item === "number") return !Number.isNaN(item);
      if (item && typeof item === "object") {
        const id = (item as Record<string, unknown>).id;
        if (typeof id === "string") return id.trim().length > 0;
        if (typeof id === "number") return !Number.isNaN(id);
      }
      return false;
    });
  }
  if (!value || typeof value !== "object") return false;
  const candidate = value as RelationPayload & Record<string, unknown>;
  const entryIds = candidate.entryIds;
  if (!Array.isArray(entryIds)) return false;
  return entryIds.some((id) => {
    if (typeof id === "string") return id.trim().length > 0;
    if (typeof id === "number") return !Number.isNaN(id);
    if (id && typeof id === "object") {
      const innerId = (id as Record<string, unknown>).id;
      if (typeof innerId === "string") return innerId.trim().length > 0;
      if (typeof innerId === "number") return !Number.isNaN(innerId);
    }
    return false;
  });
};

const isRichTextPayload = (value: unknown): value is RichTextPayload => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.type !== "rich_text") return false;
  if (!("value" in candidate) || !isRichTextNode(candidate.value)) return false;
  return true;
};

const hasText = (node: RichTextNode | null | undefined): boolean => {
  if (!node) return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (Array.isArray(node)) return node.some((child) => hasText(child));
  if (typeof node.text === "string" && node.text.trim().length > 0) return true;
  if (Array.isArray(node.content)) return node.content.some((child) => hasText(child));
  return false;
};

export const setupValidation = () => {
  defineRule("required", required);
  defineRule("email", email);
  defineRule("min", min);
  defineRule("max", max);

  // Rich text required: checks TipTap JSON content has any non-empty text
  defineRule("rich_text_required", (value: unknown) => {
    // Accept either plain string or { type: 'rich_text', value: JSON }
    if (typeof value === "string") {
      return value.trim().length > 0 || "このフィールドは必須です";
    }
    if (isRichTextPayload(value)) {
      return hasText(value.value) || "このフィールドは必須です";
    }
    return "このフィールドは必須です";
  });

  defineRule("relation_required", (value: unknown) => {
    return hasRelationEntries(value) || "このフィールドは必須です";
  });

  // Configure localized messages (en, ja)
  configure({
    generateMessage: localize({ en, ja }),
  });
};

export const setValidationLocale = (loc: string) => {
  // Fallback to 'en' when unknown
  setVeeLocale(loc === "ja" ? "ja" : "en");
};

export default setupValidation;
