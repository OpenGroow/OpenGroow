import { describe, expect, it } from "vitest";
import { isNewerVersion, versionOfTag } from "../src/lib/package-versions";

describe("package versions", () => {
  it("reads the version of a hub tag", () => {
    expect(versionOfTag("publisher-postiz@1.0.2")).toBe("1.0.2");
    expect(versionOfTag("source@2.0.0-rc.1")).toBe("2.0.0-rc.1");
    expect(versionOfTag("postiz")).toBeUndefined();
    expect(versionOfTag("postiz@latest")).toBeUndefined();
  });

  it("compares versions numerically, a release beating its pre-release", () => {
    expect(isNewerVersion("1.0.2", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.10.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.1", "1.0.1")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(true);
    expect(isNewerVersion("1.0.0-rc.1", "1.0.0")).toBe(false);
  });
});
