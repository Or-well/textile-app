import { describe, expect, it } from "vitest";
import { formatNativePathForDisplay } from "../../src/utils/nativePath";

describe("native path display", () => {
  it("removes the Windows extended-length prefix from drive paths", () => {
    expect(formatNativePathForDisplay("\\\\?\\D:\\Projects\\Demo")).toBe(
      "D:\\Projects\\Demo",
    );
  });

  it("removes the Windows extended-length prefix from UNC paths", () => {
    expect(
      formatNativePathForDisplay("\\\\?\\UNC\\server\\share\\Demo"),
    ).toBe("\\\\server\\share\\Demo");
  });

  it("keeps regular paths unchanged", () => {
    expect(formatNativePathForDisplay("D:\\Projects\\Demo")).toBe(
      "D:\\Projects\\Demo",
    );
  });
});
