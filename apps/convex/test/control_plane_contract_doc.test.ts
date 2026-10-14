import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contract (#719): docs/CONTROL_PLANE.md is the written API between the product
// and the cloud. Every route the provisioner calls must be listed there, and
// control_plane_provisioner.test.ts pins the behavior of each of them.
const ROOT = join(import.meta.dirname, "..", "..", "..");
const doc = readFileSync(join(ROOT, "docs", "CONTROL_PLANE.md"), "utf8");
const source = readFileSync(join(ROOT, "apps/convex/instance_provisioning/control_plane.ts"), "utf8");

describe("docs/CONTROL_PLANE.md matches the provisioner", () => {
  it("lists every route control_plane.ts calls", () => {
    const routes = [...source.matchAll(/["'`](\/instances\/[A-Za-z/${}.]*)/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const prefix = route.replace(/\$\{[^}]*\}/g, "{x}").replace(/\/$/, "").split("/").slice(0, 3).join("/");
      expect(doc, route).toContain(prefix);
    }
  });

  it("documents the signature scheme and the pinning test", () => {
    for (const header of ["x-control-key-id", "x-control-ts", "x-control-nonce", "x-control-signature"]) {
      expect(doc).toContain(header);
    }
    expect(doc).toContain("control_plane_provisioner.test.ts");
  });
});
