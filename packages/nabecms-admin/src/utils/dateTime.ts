type AdminDateFieldFormat = "auto" | "date" | "datetime" | "datetime_with_timezone";

type AdminDateTimeParts = {
  date: Date;
  hasTime: boolean;
};

const DEFAULT_DATE_LOCALE = "en-US";
const localeAliases: Record<string, string> = {
  en: "en-US",
  ja: "ja-JP",
};
const localizedDateFormatters = new Map<string, Intl.DateTimeFormat>();

/** Left-pad a date or time number to two digits. */
const padTwoDigits = (value: number): string => value.toString().padStart(2, "0");

/** Read the persisted Admin UI locale without coupling this utility to vue-i18n. */
const getPersistedAdminLocale = (): string => {
  if (typeof window === "undefined") return DEFAULT_DATE_LOCALE;
  try {
    return window.localStorage.getItem("locale") || DEFAULT_DATE_LOCALE;
  } catch {
    return DEFAULT_DATE_LOCALE;
  }
};

/** Resolve a supported date locale from the Admin UI locale code. */
export const resolveAdminDateLocale = (locale?: string | null): string => {
  const candidate = locale ?? getPersistedAdminLocale();
  return localeAliases[candidate] ?? candidate;
};

/** Build an Intl formatter that keeps the local date order and zero-pads month/day. */
const getLocalizedDateFormatter = (locale?: string | null): Intl.DateTimeFormat => {
  const resolvedLocale = resolveAdminDateLocale(locale);
  const cached = localizedDateFormatters.get(resolvedLocale);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat(resolvedLocale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    localizedDateFormatters.set(resolvedLocale, formatter);
    return formatter;
  } catch {
    const fallbackFormatter = new Intl.DateTimeFormat(DEFAULT_DATE_LOCALE, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    localizedDateFormatters.set(resolvedLocale, fallbackFormatter);
    return fallbackFormatter;
  }
};

/** Format date parts with the active locale ordering. */
const formatLocalizedDatePart = (date: Date, locale?: string | null): string => getLocalizedDateFormatter(locale).format(date);

/** Format local time as a stable zero-padded 24-hour timestamp. */
const formatLocalTimePart = (date: Date): string => {
  const hour = padTwoDigits(date.getHours());
  const minute = padTwoDigits(date.getMinutes());
  const second = padTwoDigits(date.getSeconds());
  return `${hour}:${minute}:${second}`;
};

/** Build local date and time parts for admin timestamp display. */
const toLocalDateTimeParts = (date: Date): AdminDateTimeParts => {
  return {
    date,
    hasTime: formatLocalTimePart(date) !== "00:00:00",
  };
};

/** Resolve whether a string timestamp carries an explicit timezone. */
const hasExplicitTimezone = (value: string): boolean => /(?:Z|[+-]\d{2}:?\d{2})$/iu.test(value.trim());

/** Build a local Date and reject impossible calendar values. */
const toValidatedLocalDate = ({
  year,
  month,
  day,
  hour,
  minute,
  second,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): Date | null => {
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date;
};

/** Build display parts from numeric date and time captures. */
const toDateTimePartsFromNumbers = ({
  year,
  month,
  day,
  hour,
  minute,
  second,
}: {
  year: string;
  month: string;
  day: string;
  hour?: string;
  minute?: string;
  second?: string;
}): AdminDateTimeParts => {
  const date = toValidatedLocalDate({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour ?? 0),
    minute: Number(minute ?? 0),
    second: Number(second ?? 0),
  });
  if (!date) {
    return {
      date: new Date(Number.NaN),
      hasTime: false,
    };
  }
  return {
    date,
    hasTime: typeof hour === "string" || typeof minute === "string" || typeof second === "string",
  };
};

/** Parse common Japanese and American slash date strings without relying on browser locale parsing. */
const parseLooseDateString = (value: string): AdminDateTimeParts | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || hasExplicitTimezone(trimmed)) return null;

  const japaneseMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/u);
  if (japaneseMatch) {
    const [, year, month, day, hour, minute, second] = japaneseMatch;
    if (!year || !month || !day) return null;
    const parts = toDateTimePartsFromNumbers({
      year,
      month,
      day,
      hour,
      minute,
      second,
    });
    return Number.isNaN(parts.date.getTime()) ? null : parts;
  }

  const americanMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/u);
  if (americanMatch) {
    const [, month, day, year, hour, minute, second] = americanMatch;
    if (!year || !month || !day) return null;
    const parts = toDateTimePartsFromNumbers({
      year,
      month,
      day,
      hour,
      minute,
      second,
    });
    return Number.isNaN(parts.date.getTime()) ? null : parts;
  }

  return null;
};

/** Convert an admin date display value into local date-time display parts. */
const toAdminDateTimeParts = (value: Date | string): AdminDateTimeParts | null => {
  if (typeof value === "string") {
    const looseParts = parseLooseDateString(value);
    if (looseParts) return looseParts;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return toLocalDateTimeParts(date);
};

/**
 * Format an admin date with locale-specific date ordering and zero-padded month/day.
 */
export const formatLocalizedDate = (value: Date | string, locale?: string | null): string => {
  const parts = toAdminDateTimeParts(value);
  return parts ? formatLocalizedDatePart(parts.date, locale) : typeof value === "string" ? value : "";
};

/**
 * Format an admin timestamp with locale-specific date ordering and stable zero-padded time.
 */
export const formatLocalizedDateTime = (value: Date | string, locale?: string | null): string => {
  const parts = toAdminDateTimeParts(value);
  if (!parts) return typeof value === "string" ? value : "";
  return `${formatLocalizedDatePart(parts.date, locale)} ${formatLocalTimePart(parts.date)}`;
};

/**
 * Format an entry date field value with locale-specific date ordering.
 */
export const formatAdminDateFieldValue = (value: unknown, format: AdminDateFieldFormat = "auto", locale?: string | null): string => {
  if (value == null) return "";
  if (!(value instanceof Date) && typeof value !== "string") return String(value);

  const parts = toAdminDateTimeParts(value);
  if (!parts) return typeof value === "string" ? value : "";
  if (format === "date") return formatLocalizedDatePart(parts.date, locale);
  if (format === "auto" && !parts.hasTime) return formatLocalizedDatePart(parts.date, locale);
  return `${formatLocalizedDatePart(parts.date, locale)} ${formatLocalTimePart(parts.date)}`;
};

/**
 * Split an admin timestamp into locale-specific date and time display parts.
 */
export const formatLocalizedDateTimeParts = (value: Date | string, locale?: string | null): { date: string; time: string } => {
  const parts = toAdminDateTimeParts(value);
  if (!parts) {
    return {
      date: typeof value === "string" ? value : "",
      time: "",
    };
  }

  return {
    date: formatLocalizedDatePart(parts.date, locale),
    time: formatLocalTimePart(parts.date),
  };
};

/** @deprecated Use formatLocalizedDate. */
export const formatJapaneseDate = formatLocalizedDate;

/** @deprecated Use formatLocalizedDateTime. */
export const formatJapaneseDateTime = formatLocalizedDateTime;

/** @deprecated Use formatLocalizedDateTimeParts. */
export const formatJapaneseDateTimeParts = formatLocalizedDateTimeParts;
