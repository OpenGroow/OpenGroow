import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStateRoot } from "../src/state-root.js";

describe("resolveStateRoot", () => {
  it("keeps the paired node's state under the user's home directory", () => {
    expect(resolveStateRoot("/home/user")).toBe(path.join("/home/user", ".openclaw-opengroow-connect"));
  });
});
