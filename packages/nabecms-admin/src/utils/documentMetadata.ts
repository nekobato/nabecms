import type { RouteRecordName } from "vue-router";
import { adminThemeColor } from "../theme/palette";

type Translate = (key: string) => string;

export type RouteMetadataContext = {
  routeName?: RouteRecordName | null;
  routeParams?: Record<string, unknown>;
  locale: string;
  t: Translate;
};

export type ResolvedDocumentMetadata = {
  applicationName: string;
  title: string;
  description: string;
  lang: string;
  robots: string;
  themeColor: string;
  colorScheme: string;
};

type RouteMetadataDescriptor = {
  titleKey?: string;
  descriptionKey?: string;
  titleBuilder?: (params: Record<string, unknown> | undefined, t: Translate) => string | null;
};

const ADMIN_ROBOTS = "noindex, nofollow";
const ADMIN_COLOR_SCHEME = "light";

const joinTitleParts = (...parts: (string | null | undefined)[]) => parts.filter((part): part is string => Boolean(part && part.trim())).join(" | ");

const getRouteKey = (routeName?: RouteRecordName | null): string | null => (typeof routeName === "string" && routeName.trim().length > 0 ? routeName : null);

const getRouteParam = (params: Record<string, unknown> | undefined, key: string): string | null => {
  const value = params?.[key];
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    return first?.trim() ?? null;
  }
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const buildDocumentTitle = (pageTitle: string | null, applicationName: string): string => {
  if (!pageTitle) return applicationName;
  const normalizedPageTitle = pageTitle.trim();
  const normalizedApplicationName = applicationName.trim();

  if (
    normalizedPageTitle === normalizedApplicationName ||
    normalizedPageTitle.startsWith(normalizedApplicationName) ||
    normalizedPageTitle.endsWith(normalizedApplicationName)
  ) {
    return normalizedPageTitle;
  }

  return joinTitleParts(normalizedPageTitle, normalizedApplicationName);
};

const routeMetadataByName: Record<string, RouteMetadataDescriptor> = {
  dashboard: {
    titleKey: "dashboard.title",
    descriptionKey: "dashboard.description",
  },
  login: {
    titleKey: "auth.login.title",
    descriptionKey: "auth.login.description",
  },
  logout: {
    titleKey: "auth.logout.title",
  },
  "invite-accept": {
    titleKey: "auth.invite.title",
    descriptionKey: "auth.invite.description",
  },
  initialize: {
    titleKey: "auth.signup.title",
    descriptionKey: "auth.signup.description",
  },
  "reset-password": {
    titleKey: "auth.reset_password.title",
    descriptionKey: "auth.reset_password.description",
  },
  models: {
    titleKey: "models.list.title",
  },
  "model-create": {
    titleKey: "models.create.title",
    descriptionKey: "models.create.description",
  },
  "model-detail": {
    titleBuilder: (params, t) => joinTitleParts(getRouteParam(params, "modelId"), t("models.detail.title")),
  },
  contents: {
    titleKey: "contents.list.title",
    descriptionKey: "contents.list.description",
  },
  "model-entries": {
    titleBuilder: (params, t) => joinTitleParts(getRouteParam(params, "modelId"), t("contents.entries.title_suffix")),
  },
  "entry-sheet": {
    titleBuilder: (params, t) => joinTitleParts(getRouteParam(params, "modelId"), t("contents.sheet.title_suffix")),
    descriptionKey: "contents.sheet.description",
  },
  "entry-create": {
    titleBuilder: (params, t) => joinTitleParts(getRouteParam(params, "modelId"), t("contents.create.title_suffix")),
  },
  "entry-edit": {
    titleKey: "contents.edit.title",
  },
  logs: {
    titleKey: "logs.title",
    descriptionKey: "logs.description",
  },
  media: {
    titleKey: "media.list.title",
  },
  "media-detail": {
    titleBuilder: (params, t) => joinTitleParts(getRouteParam(params, "mediaId"), t("media.detail.title")),
  },
  settings: {
    titleKey: "settings.title",
    descriptionKey: "settings.description",
  },
  "settings-locales": {
    titleKey: "settings.locales.title",
    descriptionKey: "settings.locales.description",
  },
  "settings-users": {
    titleKey: "settings.users.title",
    descriptionKey: "settings.users.description",
  },
  "settings-roles": {
    titleKey: "settings.roles.title",
    descriptionKey: "settings.roles.description",
  },
  "settings-api-keys": {
    titleKey: "settings.api_keys.title",
    descriptionKey: "settings.api_keys.description",
  },
  "settings-email": { titleKey: "emailSettings.title", descriptionKey: "emailSettings.description" },
  "forgot-password": { titleKey: "emailSettings.forgot", descriptionKey: "emailSettings.description" },
  "settings-logs": {
    titleKey: "logManagement.title",
    descriptionKey: "logManagement.description",
  },
  "settings-hooks": {
    titleKey: "settings.hooks.title",
    descriptionKey: "settings.hooks.description",
  },
};

const resolveRouteDescriptor = (routeName?: RouteRecordName | null): RouteMetadataDescriptor => {
  const routeKey = getRouteKey(routeName);
  return routeKey ? (routeMetadataByName[routeKey] ?? {}) : {};
};

const upsertNamedMeta = (doc: Document, name: string, content: string) => {
  const selector = `meta[name="${name}"]`;
  const existing = doc.head.querySelector(selector);
  const meta = existing instanceof HTMLMetaElement ? existing : doc.createElement("meta");
  meta.setAttribute("name", name);
  meta.setAttribute("content", content);
  if (!existing) {
    doc.head.append(meta);
  }
};

export function resolveDocumentMetadata({ routeName, routeParams, locale, t }: RouteMetadataContext): ResolvedDocumentMetadata {
  const applicationName = t("app.title");
  const fallbackDescription = t("app.meta_description");
  const descriptor = resolveRouteDescriptor(routeName);
  const pageTitle = descriptor.titleBuilder?.(routeParams, t) ?? (descriptor.titleKey ? t(descriptor.titleKey) : null);
  const description = descriptor.descriptionKey ? t(descriptor.descriptionKey) : fallbackDescription;

  return {
    applicationName,
    title: buildDocumentTitle(pageTitle, applicationName),
    description,
    lang: locale.trim().length > 0 ? locale.trim() : "en",
    robots: ADMIN_ROBOTS,
    themeColor: adminThemeColor,
    colorScheme: ADMIN_COLOR_SCHEME,
  };
}

export function applyDocumentMetadata(doc: Document, metadata: ResolvedDocumentMetadata): ResolvedDocumentMetadata {
  doc.title = metadata.title;
  doc.documentElement.lang = metadata.lang;

  upsertNamedMeta(doc, "application-name", metadata.applicationName);
  upsertNamedMeta(doc, "description", metadata.description);
  upsertNamedMeta(doc, "robots", metadata.robots);
  upsertNamedMeta(doc, "color-scheme", metadata.colorScheme);
  upsertNamedMeta(doc, "theme-color", metadata.themeColor);

  return metadata;
}

export function syncDocumentMetadata(context: RouteMetadataContext, doc: Document = document): ResolvedDocumentMetadata {
  return applyDocumentMetadata(doc, resolveDocumentMetadata(context));
}
