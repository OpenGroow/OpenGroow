import { describe, expect, it } from "vitest";
import { buildConvexRunArgs, parseTemplateAddArgs } from "../scripts/template-add.js";

describe("parseTemplateAddArgs", () => {
  it("reads the folder, the Project and the arguments forwarded to `convex run` after --", () => {
    expect(parseTemplateAddArgs(["../seo", "--project", "openclaw-abc", "--", "--url", "http://127.0.0.1:3210"])).toEqual({
      folder: "../seo",
      projectId: "openclaw-abc",
      convexArgs: ["--url", "http://127.0.0.1:3210"],
    });
  });

  it("requires a folder and a Project", () => {
    expect(() => parseTemplateAddArgs(["--project", "p"])).toThrow(/<folder>/);
    expect(() => parseTemplateAddArgs(["../seo"])).toThrow(/--project/);
  });
});

describe("buildConvexRunArgs", () => {
  it("runs the identity-free install action with the package files as JSON", () => {
    const args = buildConvexRunArgs("openclaw-abc", [{ path: "CLAW.md", content: "# c" }], ["--prod"]);
    expect(args.slice(0, 3)).toEqual(["convex", "run", "template_install_local:addFromFolder"]);
    expect(JSON.parse(args[3]!)).toEqual({ projectId: "openclaw-abc", files: [{ path: "CLAW.md", content: "# c" }] });
    expect(args.slice(4)).toEqual(["--prod"]);
  });
});
