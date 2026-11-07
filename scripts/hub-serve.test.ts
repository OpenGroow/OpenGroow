import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ES module script
import { fileFor } from "./hub-serve.mjs";

describe("hub-serve routes", () => {
  const hub = "/hub";

  it("maps the two indexes and release assets to the hub folder", () => {
    expect(fileFor(hub, "/publishers.json")).toBe("/hub/publishers.json");
    expect(fileFor(hub, "/index.json")).toBe("/hub/index.json");
    expect(fileFor(hub, "/releases/publisher-postiz@1.0.0/opengroow-publisher-postiz-1.0.0.tgz")).toBe("/hub/dist/opengroow-publisher-postiz-1.0.0.tgz");
    expect(fileFor(hub, "/releases/publisher-postiz%401.0.0/a.tgz")).toBe("/hub/dist/a.tgz");
  });

  it.each([
    "/",
    "/package.json",
    "/../etc/passwd",
    "/releases/x@1/../../secret.tgz",
    "/releases/x@1/a.json",
    "/releases/..%2f/a.tgz",
    "/releases/x@1/..%2fa.tgz",
    "/releases/x@1",
    "/dist/a.tgz",
  ])("refuses %s", (path) => {
    expect(fileFor(hub, path)).toBeUndefined();
  });
});
