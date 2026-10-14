import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoPackageTemplate, seoFixtureTemplate } from "./__fixtures__/templates.js";
import { validateManifest } from "./index.js";

const SERVER = { name: "svc", transport: "streamable-http", url: "http://localhost/mcp" };

const POLLING = {
  server: "svc",
  mcpTool: "get_status",
  statusField: "status",
  terminalStates: { completed: ["done"], failed: ["failed"] },
  resultStatus: "success",
  artifactKind: "markdown",
  onComplete: "terminal",
};

const BASE = {
  id: "test",
  name: "Test",
  description: "Test template",
  category: "demo",
  mcpServers: [SERVER],
};

function missionType(extra: Record<string, unknown> = {}) {
  return { type: "make", label: "Make", payload: "{}", agentsMd: "make.md", ...extra };
}

function expectRejected(manifest: unknown, ...fragments: string[]) {
  const result = validateManifest(manifest);
  expect(result.ok).toBe(false);
  if (!result.ok) for (const fragment of fragments) expect(result.reason).toContain(fragment);
}

describe("validateManifest — unknown keys are refused (issue #644)", () => {
  it("accepts a manifest with only known keys", () => {
    expect(validateManifest({ ...BASE, missionTypes: [missionType()] }).ok).toBe(true);
  });

  it("rejects an unknown top-level key, naming it", () => {
    expectRejected({ ...BASE, schemaVersoin: 1 }, "schemaVersoin");
  });

  it("rejects an unknown key inside an mcpServers entry", () => {
    expectRejected({ ...BASE, mcpServers: [{ ...SERVER, extra: 1 }] }, "mcpServers[0].extra");
  });

  it("rejects an unknown key inside a Mission type", () => {
    expectRejected({ ...BASE, missionTypes: [missionType({ lable: "x" })] }, 'missionTypes["make"].lable');
  });

  it("rejects an unknown key inside a Mission type payload field", () => {
    expectRejected(
      { ...BASE, missionTypes: [missionType({ fields: [{ key: "k", label: "K", type: "text", bogus: 1 }] })] },
      'missionTypes["make"].fields[0].bogus',
    );
  });

  it("rejects an unknown key inside a review contract", () => {
    const review = { kind: "markdown", service: "workspace", bogus: true };
    expectRejected({ ...BASE, missionTypes: [missionType({ review })] }, 'missionTypes["make"].review.bogus');
  });

  it("rejects an unknown key inside a review action", () => {
    const review = {
      kind: "markdown",
      service: "workspace",
      actions: [{ key: "approve", label: "OK", requiredStatus: "to_validate", transition: "approved", bogus: 1 }],
    };
    expectRejected({ ...BASE, missionTypes: [missionType({ review })] }, 'missionTypes["make"].review.actions[0].bogus');
  });

  it("rejects an unknown key inside a review action input and effect", () => {
    const action = (extra: Record<string, unknown>) => ({
      key: "publish",
      label: "Publish",
      requiredStatus: "approved",
      transition: "done",
      ...extra,
    });
    const withReview = (a: unknown) => ({
      ...BASE,
      missionTypes: [missionType({ review: { kind: "markdown", service: "workspace", actions: [a] } })],
    });
    expectRejected(
      withReview(action({ inputs: [{ key: "d", label: "D", type: "text", required: true, bogus: 1 }] })),
      "review.actions[0].inputs[0].bogus",
    );
    expectRejected(
      withReview(action({ effect: { server: "svc", method: "POST", path: "/x", bogus: 1 } })),
      "review.actions[0].effect.bogus",
    );
  });

  it("names a stray `kind` on an HTTP review effect", () => {
    const review = {
      kind: "markdown",
      service: "workspace",
      actions: [
        {
          key: "publish",
          label: "Publish",
          requiredStatus: "approved",
          transition: "done",
          effect: { server: "svc", method: "POST", path: "/x", kind: "http" },
        },
      ],
    };
    expectRejected({ ...BASE, missionTypes: [missionType({ review })] }, "review.actions[0].effect.kind");
  });

  it("rejects an unknown key inside sessionDurationMs, reconfiguration and externalJobsBySource", () => {
    expectRejected(
      { ...BASE, missionTypes: [missionType({ sessionDurationMs: { min: 1, max: 2, bogus: 1 } })] },
      'missionTypes["make"].sessionDurationMs.bogus',
    );
    expectRejected(
      { ...BASE, reconfiguration: { server: "svc", method: "PATCH", path: "/p", responseIdField: "id", bogus: 1 } },
      "reconfiguration.bogus",
    );
    const { resultStatus: _r, artifactKind: _a, onComplete: _o, ...core } = POLLING;
    expectRejected(
      {
        ...BASE,
        sources: [{ type: "post", label: "Post", family: "social", agentsMd: "post.md", analysisSchema: { type: "object" } }],
        externalJobsBySource: { post: { fetch: { ...core, bogus: 1 } } },
      },
      'externalJobsBySource["post"]["fetch"].bogus',
    );
  });

  it("rejects an unknown key inside a blocker", () => {
    const blockers = [{ code: "c", label: "C", resolutionKind: "link", bogus: 1 }];
    expectRejected({ ...BASE, missionTypes: [missionType({ blockers })] }, 'missionTypes["make"].blockers[0].bogus');
  });

  it("rejects an unknown key inside an external job contract", () => {
    expectRejected(
      {
        ...BASE,
        missionTypes: [missionType()],
        externalJobsByMissionType: { make: { generate: { ...POLLING, bogus: 1 } } },
      },
      'externalJobsByMissionType["make"]["generate"].bogus',
    );
  });

  it("rejects an unknown key inside external job terminalStates", () => {
    expectRejected(
      {
        ...BASE,
        missionTypes: [missionType()],
        externalJobsByMissionType: {
          make: { generate: { ...POLLING, terminalStates: { completed: [], failed: [], bogus: [] } } },
        },
      },
      'externalJobsByMissionType["make"]["generate"].terminalStates.bogus',
    );
  });

  it("rejects an unknown key inside a requirement, a group field and a select option", () => {
    const req = { key: "k", type: "text", label: "K", required: true };
    expectRejected({ ...BASE, requirements: [{ ...req, bogus: 1 }] }, "requirements[0].bogus");
    expectRejected(
      { ...BASE, requirements: [{ type: "group", label: "G", fields: [{ ...req, bogus: 1 }] }] },
      "requirements[0].fields[0].bogus",
    );
    expectRejected(
      { ...BASE, requirements: [{ ...req, type: "select", options: [{ value: "a", label: "A", bogus: 1 }] }] },
      "requirements[0].options[0].bogus",
    );
  });

  it("rejects an unknown key inside skills, statusCheck, activation, sources and jobTypes", () => {
    expectRejected({ ...BASE, skills: [{ source: "clawhub", spec: "@a/b", bogus: 1 }] }, "skills[0].bogus");
    expectRejected({ ...BASE, statusCheck: { server: "svc", mcpTool: "t", bogus: 1 } }, "statusCheck.bogus");
    expectRejected(
      {
        ...BASE,
        activation: { server: "svc", method: "POST", path: "/p", body: { id: "{responseId}" }, responseIdField: "id", bogus: 1 },
      },
      "activation.bogus",
    );
    expectRejected(
      {
        ...BASE,
        sources: [
          {
            type: "post",
            label: "Post",
            family: "social",
            agentsMd: "post.md",
            analysisSchema: { type: "object" },
            bogus: 1,
          },
        ],
      },
      'sources["post"].bogus',
    );
    expectRejected({ ...BASE, jobTypes: [{ type: "j", agentsMd: "j.md", bogus: 1 }] }, 'jobTypes["j"].bogus');
  });

  it("rejects an unknown key inside generativeMcpCall entries", () => {
    expectRejected(
      { ...BASE, missionTypes: [missionType()], generativeMcpCall: { make: { toolName: "t", bogus: 1 } } },
      'generativeMcpCall["make"].bogus',
    );
  });

  it("accepts an OpenClaw profile (tool deny-list, exec node) and refuses unknown or malformed ones (issue #657)", () => {
    const profile = { toolDeny: ["sessions_spawn"], execNode: "My Computer" };
    expect(validateManifest({ ...BASE, openclawProfile: profile }).ok).toBe(true);
    expectRejected({ ...BASE, openclawProfile: { toolDeney: [] } }, "openclawProfile.toolDeney");
    expectRejected({ ...BASE, openclawProfile: { toolDeny: [""] } }, "openclawProfile");
    expectRejected({ ...BASE, openclawProfile: { execNode: " " } }, "openclawProfile");
    expectRejected({ ...BASE, openclawProfile: "x" }, "openclawProfile");
  });

  it("accepts machine prerequisites and refuses malformed or unknown ones (issue #662)", () => {
    const ok = { name: "Android CLI", minVersion: "1.0", instructionsUrl: "https://example.com/doc" };
    expect(validateManifest({ ...BASE, machinePrerequisites: [ok] }).ok).toBe(true);
    expect(validateManifest({ ...BASE, machinePrerequisites: [{ name: "x", instructionsUrl: "https://e.com" }] }).ok).toBe(true);
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, bogus: 1 }] }, 'machinePrerequisites[0].bogus');
    expectRejected({ ...BASE, machinePrerequisites: "x" }, "machinePrerequisites");
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, name: " " }] }, "machinePrerequisites");
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, instructionsUrl: "javascript:alert(1)" }] }, "machinePrerequisites");
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, minVersion: "" }] }, "machinePrerequisites");
  });

  it("accepts an npm install command and external prerequisites, strictly (#736)", () => {
    const ok = {
      name: "Android CLI",
      minVersion: "0.1.0",
      instructionsUrl: "https://example.com/doc",
      installCommand: "npm install -g @acme/some-tool",
      externalPrerequisites: [{ name: "Python 3.10+", instructionsUrl: "https://www.python.org/downloads/" }],
    };
    expect(validateManifest({ ...BASE, machinePrerequisites: [ok] }).ok).toBe(true);
    expect(validateManifest({ ...BASE, machinePrerequisites: [{ ...ok, installCommand: "npm install -g left-pad@1.3.0" }] }).ok).toBe(true);
    for (const installCommand of ["", "npm install -g x; rm -rf /", "curl https://x.sh | sh", "npm install -g @a/b && ls", "npm i -g $(whoami)"]) {
      expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, installCommand }] }, "installCommand");
    }
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, externalPrerequisites: "x" }] }, "externalPrerequisites");
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, externalPrerequisites: [{ name: " ", instructionsUrl: "https://e.com" }] }] }, "externalPrerequisites[0].name");
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, externalPrerequisites: [{ name: "adb", instructionsUrl: "javascript:x" }] }] }, "externalPrerequisites[0].instructionsUrl");
    expectRejected({ ...BASE, machinePrerequisites: [{ ...ok, externalPrerequisites: [{ name: "adb", instructionsUrl: "https://e.com", bogus: 1 }] }] }, "externalPrerequisites[0].bogus");
  });

  it("still validates every Template fixture", () => {
    const root = join(import.meta.dirname, "../../../apps/convex/test/fixtures/templates");
    let count = 0;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(readFileSync(join(root, entry.name, "manifest.json"), "utf-8"));
      const result = validateManifest(manifest);
      expect(result, `${entry.name}: ${result.ok ? "" : result.reason}`).toMatchObject({ ok: true });
      count += 1;
    }
    for (const template of [
      seoFixtureTemplate(),
      repoPackageTemplate("hello"),
      repoPackageTemplate("source"),
      repoPackageTemplate("engagement"),
    ]) {
      const result = validateManifest(template.manifest);
      expect(result, `${template.manifest.id}: ${result.ok ? "" : result.reason}`).toMatchObject({ ok: true });
      count += 1;
    }
    expect(count).toBeGreaterThan(0);
  });
});
