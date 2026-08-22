import { describe, expect, it } from "vitest";
import { createZip, readZip } from "../../src/utils/zip";

describe("zip generation", () => {
  it("compresses generated packages with DEFLATE", async () => {
    const content = "A".repeat(1024 * 1024);
    const blob = await createZip({ "repeated.txt": content });

    expect(blob.size).toBeLessThan(20_000);
    await expect(readZip(await blob.arrayBuffer())).resolves.toEqual({
      "repeated.txt": content,
    });
  });
});
