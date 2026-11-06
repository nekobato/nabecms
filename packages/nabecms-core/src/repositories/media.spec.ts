import { describe, expect, it, vi } from "vitest";
import { createMediaRepository } from "./media";

describe("media repository", () => {
  it("chunks media constraint lookups at the D1 100-binding limit", async () => {
    const select = vi.fn(() => {
      const chunkNumber = select.mock.calls.length;
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() =>
          Promise.resolve([
            {
              id: `media_result_${chunkNumber}`,
              type: "image",
            },
          ]),
        ),
      };
      return query;
    });
    const repo = createMediaRepository({ select } as never);

    const rows = await repo.findByIds(
      Array.from({ length: 201 }, (_, index) => `media_${index}`),
    );

    expect(select).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(3);
  });
});
