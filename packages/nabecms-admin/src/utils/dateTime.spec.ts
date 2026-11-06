import { describe, expect, it } from "vitest";
import { formatAdminDateFieldValue, formatLocalizedDate, formatLocalizedDateTime, formatLocalizedDateTimeParts, resolveAdminDateLocale } from "./dateTime";

describe("resolveAdminDateLocale", () => {
  it("maps Admin UI locale aliases to concrete date locales", () => {
    expect(resolveAdminDateLocale("ja")).toBe("ja-JP");
    expect(resolveAdminDateLocale("en")).toBe("en-US");
  });
});

describe("formatLocalizedDate", () => {
  it("formats dates with Japanese date ordering for Japanese locales", () => {
    expect(formatLocalizedDate(new Date(2026, 4, 1, 3, 48, 24), "ja-JP")).toBe("2026/05/01");
  });

  it("formats dates with American date ordering for en-US", () => {
    expect(formatLocalizedDate(new Date(2026, 4, 1, 3, 48, 24), "en-US")).toBe("05/01/2026");
  });

  it("zero-pads loose Japanese slash date strings in the requested locale order", () => {
    expect(formatLocalizedDate("2026/5/21", "en-US")).toBe("05/21/2026");
    expect(formatLocalizedDate("2026/5/21", "ja-JP")).toBe("2026/05/21");
  });

  it("zero-pads loose American slash date strings in the requested locale order", () => {
    expect(formatLocalizedDate("5/21/2026", "en-US")).toBe("05/21/2026");
    expect(formatLocalizedDate("5/21/2026", "ja-JP")).toBe("2026/05/21");
  });

  it("returns the original string when the date is invalid", () => {
    expect(formatLocalizedDate("not-a-date", "en-US")).toBe("not-a-date");
  });
});

describe("formatLocalizedDateTime", () => {
  it("formats timestamps with locale-specific date ordering", () => {
    const value = new Date(2026, 4, 1, 3, 48, 24);
    expect(formatLocalizedDateTime(value, "ja-JP")).toBe("2026/05/01 03:48:24");
    expect(formatLocalizedDateTime(value, "en-US")).toBe("05/01/2026 03:48:24");
  });

  it("zero-pads loose timestamp strings", () => {
    expect(formatLocalizedDateTime("2026/5/21 3:4:5", "en-US")).toBe("05/21/2026 03:04:05");
  });

  it("returns the original string when the timestamp is invalid", () => {
    expect(formatLocalizedDateTime("not-a-date", "en-US")).toBe("not-a-date");
  });
});

describe("formatAdminDateFieldValue", () => {
  it("keeps date-only field values as zero-padded dates in locale order", () => {
    expect(formatAdminDateFieldValue("2026/5/21", "auto", "ja-JP")).toBe("2026/05/21");
    expect(formatAdminDateFieldValue("2026/5/21", "auto", "en-US")).toBe("05/21/2026");
  });

  it("zero-pads American date-only field values", () => {
    expect(formatAdminDateFieldValue("5/21/2026", "auto", "en-US")).toBe("05/21/2026");
  });

  it("keeps datetime field values as zero-padded timestamps", () => {
    expect(formatAdminDateFieldValue("2026/5/21 3:4:5", "auto", "en-US")).toBe("05/21/2026 03:04:05");
  });

  it("can force date-only output for date fields that contain time", () => {
    expect(formatAdminDateFieldValue("2026/5/21 3:4:5", "date", "ja-JP")).toBe("2026/05/21");
  });
});

describe("formatLocalizedDateTimeParts", () => {
  it("splits timestamps into date and time lines", () => {
    expect(formatLocalizedDateTimeParts(new Date(2026, 4, 1, 3, 48, 24), "en-US")).toEqual({
      date: "05/01/2026",
      time: "03:48:24",
    });
  });

  it("keeps invalid timestamp strings in the date line", () => {
    expect(formatLocalizedDateTimeParts("not-a-date", "en-US")).toEqual({
      date: "not-a-date",
      time: "",
    });
  });
});
