import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("gateway Dockerfile control socket packaging", () => {
  it("packages canonical default workspace files", async () => {
    const entries = new Set(
      await readdir("apps/openclaw-docker-config/workspace-templates"),
    );

    expect(entries).toEqual(new Set(["AGENTS.md"]));
  });

  it("packages the optional plugins reconciler the entrypoint runs", async () => {
    const [dockerfile, entrypoint] = await Promise.all([
      readFile("apps/openclaw-docker-config/docker/Dockerfile", "utf8"),
      readFile("apps/openclaw-docker-config/docker/entrypoint.sh", "utf8"),
    ]);

    expect(dockerfile).toContain(
      "COPY docker/optional-plugins.js /opt/openclaw-control/optional-plugins.js",
    );
    expect(entrypoint).toContain("node /opt/openclaw-control/optional-plugins.js");
  });

  it("copies every sibling module required by socket-server.js", async () => {
    const [serverSource, dockerfile, workflowSources] = await Promise.all([
      readFile("apps/openclaw-docker-config/docker/control-socket-server.js", "utf8"),
      readFile("apps/openclaw-docker-config/docker/Dockerfile", "utf8"),
      Promise.all([
        "control-socket-workspace-workflow.js",
        "control-socket-mcp-workflow.js",
        "control-socket-plugins-workflow.js",
        "control-socket-openclaw-workflow.js",
        "control-socket-node-workflow.js",
        "control-socket-whatsapp-workflow.js",
        "control-socket-channel-workflow.js",
      ].map((fileName) => readFile(`apps/openclaw-docker-config/docker/${fileName}`, "utf8"))),
    ]);

    const requiredModules = Array.from(
      [serverSource, ...workflowSources].join("\n").matchAll(/require\("\.\/(control-socket-[^"]+)"\)/g),
      (match) => match[1],
    );

    for (const moduleName of requiredModules) {
      expect(dockerfile).toContain(
        `COPY docker/${moduleName}.js /opt/openclaw-control/${moduleName}.js`,
      );
    }
  });

  it("allows native OpenClaw agent commands through /openclaw/exec", async () => {
    const serverSource = await readFile(
      "apps/openclaw-docker-config/docker/control-socket-openclaw-workflow.js",
      "utf8",
    );

    // The Set declaration must include "agents".
    const setMatch = serverSource.match(
      /ALLOWED_OPENCLAW_ROOT_COMMANDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(setMatch, "ALLOWED_OPENCLAW_ROOT_COMMANDS Set declaration not found").not.toBeNull();
    const allowedRoots = Array.from(
      (setMatch?.[1] ?? "").matchAll(/"([^"]+)"/g),
      (m) => m[1],
    );
    expect(allowedRoots).toContain("agents");

    // The Set must gate command validation, not be a dead constant.
    expect(serverSource).toMatch(
      /function\s+normalize[\s\S]*?ALLOWED_OPENCLAW_ROOT_COMMANDS\.has\(/,
    );
  });

  it("allows Template-declared Agent Skill installs through /openclaw/exec via the separate ClawHub binary (issue #222)", async () => {
    const serverSource = await readFile(
      "apps/openclaw-docker-config/docker/control-socket-openclaw-workflow.js",
      "utf8",
    );

    // `clawhub` is a distinct binary from `openclaw` (see entrypoint.sh's
    // `clawhub install "$line" --workdir "$WORKDIR"`), so it must NOT be
    // added to ALLOWED_OPENCLAW_ROOT_COMMANDS as if it were an `openclaw`
    // subcommand.
    const openClawSetMatch = serverSource.match(
      /ALLOWED_OPENCLAW_ROOT_COMMANDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(openClawSetMatch, "ALLOWED_OPENCLAW_ROOT_COMMANDS Set declaration not found").not.toBeNull();
    const allowedOpenClawRoots = Array.from(
      (openClawSetMatch?.[1] ?? "").matchAll(/"([^"]+)"/g),
      (m) => m[1],
    );
    expect(allowedOpenClawRoots).not.toContain("skills");
    expect(allowedOpenClawRoots).not.toContain("clawhub");

    // ClawHub gets its own allowlist gating a distinct exec path (spawning
    // the `clawhub` binary instead of `openclaw`), the workspace-scoped
    // `clawhub install <spec> --workdir <path>` command Convex uses to
    // install Template-declared Agent Skills.
    const clawHubSetMatch = serverSource.match(
      /ALLOWED_CLAWHUB_ROOT_COMMANDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(clawHubSetMatch, "ALLOWED_CLAWHUB_ROOT_COMMANDS Set declaration not found").not.toBeNull();
    const allowedClawHubRoots = Array.from(
      (clawHubSetMatch?.[1] ?? "").matchAll(/"([^"]+)"/g),
      (m) => m[1],
    );
    expect(allowedClawHubRoots).toContain("install");

    // The Set must gate command validation, not be a dead constant, and
    // `clawhub` commands must be dispatched to a distinct binary.
    expect(serverSource).toMatch(
      /function\s+normalize[\s\S]*?ALLOWED_CLAWHUB_ROOT_COMMANDS\.has\(/,
    );
    expect(serverSource).toContain("runClawHubCommand");
  });
});
