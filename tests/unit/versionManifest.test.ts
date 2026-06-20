import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateBuildHash } from "../../scripts/generate-version-manifest.mjs";

const HASH_PATHS = ["src", "public", "index.html", "vite.config.ts", "package.json"];

describe("version manifest build hash", () => {
  it("normalizes text line endings and preserves binary bytes", () => {
    const lfRoot = createFixtureProject("\n", Buffer.from([0x25, 0x50, 0x44, 0x46]));
    const crlfRoot = createFixtureProject("\r\n", Buffer.from([0x25, 0x50, 0x44, 0x46]));

    try {
      expect(calculateBuildHash(crlfRoot, HASH_PATHS)).toBe(
        calculateBuildHash(lfRoot, HASH_PATHS),
      );

      writeFileSync(
        join(crlfRoot, "public", "manual.pdf"),
        Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a]),
      );

      expect(calculateBuildHash(crlfRoot, HASH_PATHS)).not.toBe(
        calculateBuildHash(lfRoot, HASH_PATHS),
      );
    } finally {
      rmSync(lfRoot, { recursive: true, force: true });
      rmSync(crlfRoot, { recursive: true, force: true });
    }
  });
});

function createFixtureProject(lineEnding: string, pdfBytes: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), "textile-version-manifest-"));

  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "public"), { recursive: true });
  writeFileSync(
    join(root, "src", "main.ts"),
    ["export const name = \"Textile\";", ""].join(lineEnding),
  );
  writeFileSync(
    join(root, "public", "icons.svg"),
    ["<svg>", "<path />", "</svg>", ""].join(lineEnding),
  );
  writeFileSync(
    join(root, "public", "version.json"),
    JSON.stringify({ build_id: lineEnding === "\n" ? "lf" : "crlf" }),
  );
  writeFileSync(join(root, "public", "manual.pdf"), pdfBytes);
  writeFileSync(join(root, "index.html"), ["<div></div>", ""].join(lineEnding));
  writeFileSync(join(root, "vite.config.ts"), ["export default {};", ""].join(lineEnding));
  writeFileSync(
    join(root, "package.json"),
    [`{"name":"textile","version":"0.0.0"}`, ""].join(lineEnding),
  );

  return root;
}
