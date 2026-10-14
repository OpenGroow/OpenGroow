import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { clawPackageToTemplate, type ClawPackageFiles } from "./claw-package.js";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "__fixtures__", "claw");

/** Every file of a fixture package, keyed by its path relative to the package root. */
function readPackage(name: string): ClawPackageFiles {
  const root = join(FIXTURES, name);
  const files: ClawPackageFiles = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(root, path).split("\\").join("/")] = readFileSync(path, "utf-8");
    }
  };
  walk(root);
  return files;
}

const clawMd = (frontmatter: string, body = "Portable prompt.") => `---\n${frontmatter}\n---\n\n${body}\n`;

/** A native CLAW.md frontmatter: `schemaVersion` plus the `agent` identity, and any extra top-level YAML. */
const nativeFront = (agent = "id: mini\n  name: Mini\n  description: A mini agent", extra = "") =>
  `schemaVersion: 1\nagent:\n  ${agent}${extra ? `\n${extra}` : ""}`;

const packageJson = (name = "mini") => JSON.stringify({ name, version: "0.0.1", openclaw: { claw: "CLAW.md" } });

/** A minimal valid package; tests override single files. */
function miniPackage(overrides: Record<string, string | null> = {}): ClawPackageFiles {
  const files: ClawPackageFiles = {
    "package.json": packageJson(),
    "CLAW.md": clawMd(nativeFront()),
    "workspace/AGENTS.md": "# Mini",
    "workspace/make.md": "# Make",
    "profiles/opengroow.yml": [
      "schemaVersion: 1",
      "category: demo",
      "mcpServers:",
      "  - name: svc",
      "    transport: streamable-http",
      "    url: http://localhost/mcp",
      "missionTypes:",
      "  - type: make",
      "    label: Make",
      '    payload: "{}"',
      "    agentsMd: make.md",
    ].join("\n"),
  };
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path];
    else files[path] = content;
  }
  return files;
}

function profile(extra: string, schemaVersion = "schemaVersion: 1") {
  return miniPackage({
    "profiles/opengroow.yml": [
      schemaVersion,
      "category: demo",
      "mcpServers:",
      "  - name: svc",
      "    transport: streamable-http",
      "    url: http://localhost/mcp",
      extra,
    ].join("\n"),
    "workspace/make.md": null,
  });
}

function expectRefused(files: ClawPackageFiles, ...fragments: string[]) {
  const result = clawPackageToTemplate(files);
  expect(result.ok).toBe(false);
  if (!result.ok) for (const fragment of fragments) expect(result.reason).toContain(fragment);
}

describe("clawPackageToTemplate — SEO fixture as a Claw package (issue #649)", () => {
  it("converts to the SEO fixture Template (review, External Jobs, statusCheck, runContext)", () => {
    const result = clawPackageToTemplate(readPackage("seo"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.manifest.id).toBe("@acme/seo");
    expect(result.template.manifest.statusCheck).toBeDefined();
    expect(result.template.manifest.runContext).toBeDefined();
    expect(result.template.manifest.externalJobsByMissionType).toBeDefined();
    expect(result.template.agentsMd.length).toBeGreaterThan(0);
  });

  it("does not leak the schema version or the portable prompt into the manifest", () => {
    const result = clawPackageToTemplate(readPackage("seo"));
    expect(result.ok && result.template.manifest).not.toHaveProperty("schemaVersion");
  });
});

describe("clawPackageToTemplate — CLAW.md", () => {
  it("takes the Template id from package.json and name and description from the native agent", () => {
    const result = clawPackageToTemplate(miniPackage({ "package.json": packageJson("@acme/mini") }));
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.manifest).toMatchObject({ id: "@acme/mini", name: "Mini", description: "A mini agent" });
  });

  it("reads required skills, with their exact version, from the native packages", () => {
    const result = clawPackageToTemplate(
      miniPackage({
        "CLAW.md": clawMd(
          nativeFront(undefined, "packages:\n  - kind: skill\n    source: clawhub\n    ref: slug\n    version: 1.2.3"),
        ),
      }),
    );
    expect(result.ok && result.template.manifest.skills).toEqual([{ source: "clawhub", spec: "slug", version: "1.2.3" }]);
  });

  it("refuses a package kind it does not install", () => {
    expectRefused(
      miniPackage({
        "CLAW.md": clawMd(nativeFront(undefined, "packages:\n  - kind: plugin\n    source: clawhub\n    ref: x\n    version: 1.0.0")),
      }),
      "CLAW.md",
      "plugin",
    );
  });

  it("refuses a skill without an exact version", () => {
    expectRefused(
      miniPackage({
        "CLAW.md": clawMd(nativeFront(undefined, "packages:\n  - kind: skill\n    source: clawhub\n    ref: slug")),
      }),
      "packages[0]",
      '"version"',
    );
  });

  it("refuses a missing CLAW.md", () => {
    expectRefused(miniPackage({ "CLAW.md": null }), "CLAW.md");
  });

  it("refuses a CLAW.md without frontmatter", () => {
    expectRefused(miniPackage({ "CLAW.md": "# Just a prompt" }), "CLAW.md", "frontmatter");
  });

  it("refuses a frontmatter that is not schemaVersion 1", () => {
    expectRefused(miniPackage({ "CLAW.md": clawMd("agent:\n  id: mini\n  name: Mini\n  description: d") }), "CLAW.md", "schemaVersion");
  });

  it.each(["id", "name", "description"])("refuses an agent without %s", (key) => {
    const fields: Record<string, string> = { id: "mini", name: "Mini", description: "d" };
    delete fields[key];
    const agent = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n  ");
    expectRefused(miniPackage({ "CLAW.md": clawMd(nativeFront(agent)) }), "CLAW.md", `agent.${key}`);
  });

  it("refuses a missing or nameless package.json", () => {
    expectRefused(miniPackage({ "package.json": null }), "package.json");
    expectRefused(miniPackage({ "package.json": "{}" }), "package.json", '"name"');
  });

  it("refuses identity or skills declared in the OpenGroow profile instead of CLAW.md", () => {
    expectRefused(profile("id: other"), "profiles/opengroow.yml", '"id"', "package.json");
    expectRefused(profile("skills: []"), '"skills"', "CLAW.md");
  });
});

describe("clawPackageToTemplate — schemaVersion", () => {
  it("accepts the current schema version (1)", () => {
    expect(clawPackageToTemplate(miniPackage()).ok).toBe(true);
  });

  it("refuses a newer schema version, naming it and the accepted one", () => {
    expectRefused(profile("", "schemaVersion: 2"), "schemaVersion", "2", "1");
  });

  it("refuses schema version 0, which never shipped", () => {
    expectRefused(profile("", "schemaVersion: 0"), "schemaVersion", "0");
  });

  it("refuses a missing schemaVersion", () => {
    expectRefused(profile("", "# no version"), "schemaVersion", "missing");
  });

  it("refuses a non-integer schemaVersion", () => {
    expectRefused(profile("", 'schemaVersion: "1"'), "schemaVersion");
    expectRefused(profile("", "schemaVersion: 1.5"), "schemaVersion");
  });
});

describe("clawPackageToTemplate — profile constraints", () => {
  it("refuses a missing profile", () => {
    expectRefused(miniPackage({ "profiles/opengroow.yml": null }), "profiles/opengroow.yml");
  });

  it("refuses a profile over 256 KiB", () => {
    expectRefused(profile(`# ${"x".repeat(256 * 1024)}`), "profiles/opengroow.yml", "256 KiB");
  });

  it("measures the size in bytes, not characters", () => {
    expectRefused(profile(`# ${"é".repeat(130 * 1024)}`), "256 KiB");
  });

  it("refuses anchors", () => {
    expectRefused(profile("x-anchor: &a 1"), "profiles/opengroow.yml", "anchor");
  });

  it("refuses aliases", () => {
    expectRefused(profile("x: &a 1\ny: *a"), "aliases");
  });

  it("refuses tags", () => {
    expectRefused(profile("category2: !!str demo"), "tag");
  });

  it("refuses merge keys", () => {
    expectRefused(profile("<<:\n  category: demo"), "merge key");
  });

  it.each([".inf", "-.inf", ".nan"])("refuses non-finite numbers (%s)", (value) => {
    expectRefused(profile(`mcpServers2: ${value}`), "profiles/opengroow.yml", "non-finite");
  });

  it("refuses non-string keys", () => {
    expectRefused(profile("? [a, b]\n: 1"), "profiles/opengroow.yml", "non-string key");
    expectRefused(profile("1: x"), "non-string key");
  });

  it("refuses invalid YAML", () => {
    expectRefused(profile("missionTypes: [unclosed"), "profiles/opengroow.yml");
  });

  it("refuses a profile that is not a mapping", () => {
    expectRefused(miniPackage({ "profiles/opengroow.yml": "- a\n- b" }), "profiles/opengroow.yml", "mapping");
  });

  it("accepts a JSON document (JSON is YAML)", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      category: "demo",
      mcpServers: [{ name: "svc", transport: "streamable-http", url: "http://localhost/mcp" }],
    });
    expect(clawPackageToTemplate(miniPackage({ "profiles/opengroow.yml": json, "workspace/make.md": null })).ok).toBe(true);
  });
});

describe("clawPackageToTemplate — unknown keys and invalid manifests", () => {
  it("refuses an unknown profile key, naming it", () => {
    expectRefused(profile("categroy: x"), "profiles/opengroow.yml", "categroy");
  });

  it("refuses an unknown nested key, naming its path", () => {
    expectRefused(
      miniPackage({
        "profiles/opengroow.yml": miniPackage()["profiles/opengroow.yml"]!.replace("    label: Make", "    label: Make\n    lable: x"),
      }),
      "profiles/opengroow.yml",
      'missionTypes["make"].lable',
    );
  });

  it("reuses manifest validation for invalid values", () => {
    expectRefused(profile("visibility: secret"), "visibility");
  });
});

describe("clawPackageToTemplate — instruction files", () => {
  it("places workspace files as the base, Mission-type, Source and Job instructions", () => {
    const manifest = {
      schemaVersion: 1,
      category: "demo",
      mcpServers: [{ name: "svc", transport: "streamable-http", url: "http://localhost/mcp" }],
      missionTypes: [{ type: "make", label: "Make", payload: "{}", agentsMd: "mission-types/make.md" }],
      sources: [{ type: "feed", label: "Feed", family: "f", agentsMd: "sources/feed.md", analysisSchema: { type: "object" } }],
      jobTypes: [{ type: "newsletter_digest", agentsMd: "jobs/digest.md" }],
    };
    const result = clawPackageToTemplate(
      miniPackage({
        "profiles/opengroow.yml": JSON.stringify(manifest),
        "workspace/make.md": null,
        "workspace/mission-types/make.md": "# make",
        "workspace/sources/feed.md": "# feed",
        "workspace/jobs/digest.md": "# digest",
      }),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.agentsMd).toBe("# Mini");
    expect(result.template.missionAgentsMd).toEqual({ make: "# make" });
    expect(result.template.sourceInstructions).toEqual({ feed: "# feed" });
    expect(result.template.jobInstructions).toEqual({ newsletter_digest: "# digest" });
  });

  it("refuses a missing workspace/AGENTS.md", () => {
    expectRefused(miniPackage({ "workspace/AGENTS.md": null }), "workspace/AGENTS.md");
  });

  it("refuses a missing Mission type instruction file, naming it", () => {
    expectRefused(miniPackage({ "workspace/make.md": null }), "workspace/make.md", '"make"');
  });

  it("refuses a missing Source instruction file, naming it", () => {
    expectRefused(
      profile(
        "sources:\n  - type: feed\n    label: Feed\n    family: f\n    agentsMd: feed.md\n    analysisSchema:\n      type: object",
      ),
      "workspace/feed.md",
      '"feed"',
    );
  });

  it("refuses a missing Job instruction file, naming it", () => {
    expectRefused(profile("jobTypes:\n  - type: newsletter_digest\n    agentsMd: jobs/digest.md"), "workspace/jobs/digest.md", '"newsletter_digest"');
  });
});

describe("clawPackageToTemplate — missionContract (expanded at conversion)", () => {
  it("expands a shared missionContract so the stored manifest stays explicit", () => {
    const review = { kind: "markdown", server: "svc", path: "/a/{id}", actions: [] };
    const files = miniPackage({
      "profiles/opengroow.yml": JSON.stringify({
        schemaVersion: 1,
        category: "demo",
        mcpServers: [{ name: "svc", transport: "streamable-http", url: "http://localhost/mcp" }],
        missionTypes: [{ type: "make", label: "Make", payload: "{}", agentsMd: "make.md" }],
        missionContract: { review },
      }),
    });
    const result = clawPackageToTemplate(files);
    if (!result.ok) throw new Error(result.reason);
    expect(result.template.manifest.missionTypes?.[0]?.review).toEqual(review);
    expect(result.template.manifest).not.toHaveProperty("missionContract");
  });

  it("refuses an unknown missionContract key, naming it", () => {
    expectRefused(profile("missionContract:\n  revew: {}"), "profiles/opengroow.yml", "missionContract.revew");
  });

  it("refuses a missionContract that is not a mapping", () => {
    expectRefused(profile("missionContract: 3"), '"missionContract"', "mapping");
  });

  it("refuses malformed missionTypes alongside a missionContract instead of throwing", () => {
    expectRefused(profile("missionContract:\n  review: {}\nmissionTypes: oops"), '"missionTypes"', "list");
  });
});
