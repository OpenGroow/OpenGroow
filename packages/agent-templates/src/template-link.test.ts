import { describe, expect, it } from "vitest";
import { buildConvexRunArgs, parseTemplateAddArgs } from "../scripts/template-add.js";
import { createSyncLoop, isIgnoredWatchPath, linkWarning, LINK_ACTION, LINK_USAGE } from "../scripts/template-link.js";

describe("template:link", () => {
  it("runs the link action, not the plain install", () => {
    const args = buildConvexRunArgs("p", [{ path: "CLAW.md", content: "#" }], [], LINK_ACTION);
    expect(args.slice(0, 3)).toEqual(["convex", "run", "template_install_local:linkFromFolder"]);
  });

  it("reports its own usage, not template:add's", () => {
    expect(() => parseTemplateAddArgs(["--project", "p"], LINK_USAGE)).toThrow(/template:link/);
  });

  it("ignores changes inside .git and node_modules", () => {
    expect(isIgnoredWatchPath("workspace/AGENTS.md")).toBe(false);
    expect(isIgnoredWatchPath("node_modules/x/index.js")).toBe(true);
    expect(isIgnoredWatchPath(".git/HEAD")).toBe(true);
    expect(isIgnoredWatchPath("workspace/.DS_Store")).toBe(true);
  });
});

describe("linkWarning", () => {
  const result = (templateId: string, reconciled: unknown[]) => JSON.stringify({ templateId, version: "0.0.1", reconciled });

  it("stays silent when an Agent of the linked Template was refreshed", () => {
    expect(linkWarning(result("seo", [{ templateId: "seo", status: "refreshed" }]), "seo")).toBeUndefined();
  });

  it("warns when no active Agent uses the Template, so the edit reached no workspace", () => {
    expect(linkWarning(result("seo", []), undefined)).toMatch(/no active Agent/);
  });

  it("warns when the folder's Template id changed since the link started", () => {
    expect(linkWarning(result("seo-2", [{ templateId: "seo-2", status: "refreshed" }]), "seo")).toMatch(/changed from "seo"/);
  });

  it("ignores output that is not the action's JSON result", () => {
    expect(linkWarning("not json", "seo")).toBeUndefined();
  });
});

describe("createSyncLoop", () => {
  it("never overlaps two syncs and runs once more when a change lands during one", async () => {
    let running = 0;
    let maxRunning = 0;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const loop = createSyncLoop(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      calls++;
      if (calls === 1) await gate;
      running--;
    });

    const first = loop.request();
    loop.request();
    loop.request();
    release();
    await first;

    expect(maxRunning).toBe(1);
    expect(calls).toBe(2);
  });

  it("keeps going after a failed sync", async () => {
    let n = 0;
    const loop = createSyncLoop(async () => {
      if (n++ === 0) throw new Error("invalid");
    });
    await loop.request();
    await loop.request();
    expect(n).toBe(2);
  });
});
