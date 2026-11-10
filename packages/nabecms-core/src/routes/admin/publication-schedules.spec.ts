import { describe, expect, it } from "vitest";
import { createApp } from "../../create-app";

describe("scheduled publishing config", () => {
  it("rejects the removed scheduled publishing config", () => {
    expect(() =>
      createApp({
        config: {
          publishing: { scheduled: { enabled: true } },
        } as never,
      }),
    ).toThrow();
  });
});
