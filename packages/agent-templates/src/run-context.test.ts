import { describe, it, expect } from "vitest";
import { seoFixtureTemplate } from "./__fixtures__/templates.js";
import { validateManifest } from "./index.js";
import { renderRunContext, runContextReferences } from "./run-context.js";

// 2026-03-15T12:00:00Z
const NOW = Date.UTC(2026, 2, 15, 12, 0, 0);

const SERVER = { name: "svc", transport: "streamable-http", url: "http://localhost/mcp" };
const BASE = { id: "t", name: "T", description: "d", category: "demo", mcpServers: [SERVER] };

function render(
  declaration: Parameters<typeof renderRunContext>[0],
  config: Record<string, unknown>,
  runId = "run-abc",
  payload?: Record<string, unknown>,
) {
  return renderRunContext(declaration, { runId, config, payload, now: NOW });
}

// A Template declares its run context in its manifest, rendered by core: no
// Template-specific code builds it.
describe("run context declared by a Template package", () => {
  const seoDeclaration = seoFixtureTemplate().manifest.runContext!;

  it("renders the declaration of the SEO fixture", () => {
    expect(render(seoDeclaration, { apiKey: "secret-key" })).toBe(
      [
        "## SEO Runtime Context",
        "",
        "- runId: `run-abc`",
        "- sinceDate: `2026-03-08` (today - 7 days, for internal_linking missions)",
        "",
      ].join("\n"),
    );
  });

  it("omits a line whose config value is absent or empty", () => {
    const declaration = { heading: "Video Runtime Context", lines: ["runId: `{run.id}`", "defaultFormat: `{config.defaultFormat}`"] };
    expect(render(declaration, { defaultFormat: "letter-only" }, "run-vid")).toBe(
      ["## Video Runtime Context", "", "- runId: `run-vid`", "- defaultFormat: `letter-only`", ""].join("\n"),
    );
    expect(render(declaration, {}, "run-vid")).toBe(["## Video Runtime Context", "", "- runId: `run-vid`", ""].join("\n"));
    expect(render(declaration, { defaultFormat: "" }, "r")).toBe(["## Video Runtime Context", "", "- runId: `r`", ""].join("\n"));
  });

  it("never writes the apiKey into the rendered context", () => {
    const out = render(seoDeclaration, { apiKey: "super-secret" });
    expect(out).not.toContain("super-secret");
    expect(out).not.toContain("apiKey");
  });

  it("a Template has no code-based runtime context", () => {
    expect(seoFixtureTemplate()).not.toHaveProperty("buildRuntimeContext");
  });
});

describe("renderRunContext", () => {
  const decl = (lines: string[]) => ({ heading: "Ctx", lines });
  const ctx = { runId: "r1", config: { a: "A", n: 3, flag: true } as Record<string, unknown>, payload: { p: "P" }, now: NOW };

  it("substitutes run id, config, payload and relative dates", () => {
    expect(
      renderRunContext(
        decl(["{run.id} {config.a} {config.n} {config.flag} {payload.p} {date.today} {date.today-1d} {date.today+30d}"]),
        ctx,
      ),
    ).toBe("## Ctx\n\n- r1 A 3 true P 2026-03-15 2026-03-14 2026-04-14\n");
  });

  it("omits a line whose reference has no value", () => {
    expect(renderRunContext(decl(["x {config.missing}", "y {payload.missing}", "z {run.id}"]), ctx)).toBe(
      "## Ctx\n\n- z r1\n",
    );
  });

  it("is plain substitution: substituted values are never re-interpreted", () => {
    const out = renderRunContext(decl(["{config.a}"]), { ...ctx, config: { a: "{run.id} ${1+1} {config.a}" } });
    expect(out).toBe("## Ctx\n\n- {run.id} ${1+1} {config.a}\n");
  });

  it("keeps a value on its own list item: line breaks cannot add headings or items", () => {
    const out = renderRunContext(decl(["note: {config.a}"]), { ...ctx, config: { a: "x\n\n## Injected\r\n- y" } });
    expect(out).toBe("## Ctx\n\n- note: x ## Injected - y\n");
  });

  it("reads no payload key when the Mission payload is not an object", () => {
    for (const payload of ["abc", ["a"], 42, null]) {
      const out = renderRunContext(decl(["{payload.length}", "z"]), { ...ctx, payload: payload as never });
      expect(out).toBe("## Ctx\n\n- z\n");
    }
  });
});

describe("runContextReferences", () => {
  it("parses the fixed grammar", () => {
    expect(runContextReferences("{run.id} {config.a_b} {payload.k} {date.today} {date.today-7d} {date.today+2d}")).toEqual([
      { kind: "run" },
      { kind: "config", key: "a_b" },
      { kind: "payload", key: "k" },
      { kind: "date", offsetDays: 0 },
      { kind: "date", offsetDays: -7 },
      { kind: "date", offsetDays: 2 },
    ]);
  });

  it.each(["{run.name}", "{foo}", "{config.}", "{config.a.b}", "{date.tomorrow}", "{date.today-d}", "{ run.id }", "{}", "{config.a", "oops }"])(
    "refuses %s",
    (text) => {
      expect(runContextReferences(text)).toBeInstanceOf(Error);
    },
  );
});

describe("validateManifest — runContext", () => {
  const withRunContext = (runContext: unknown, extra: Record<string, unknown> = {}) =>
    validateManifest({ ...BASE, ...extra, runContext });
  const reasonOf = (result: ReturnType<typeof validateManifest>) => (result.ok ? "" : result.reason);

  it("accepts a block using the whole grammar", () => {
    expect(
      withRunContext({ heading: "Ctx", lines: ["id: {run.id}", "since {date.today-7d}", "{config.mode}", "{payload.keyword}"] }, {
        missionTypes: [{ type: "make", label: "Make", payload: "{}", agentsMd: "make.md", fields: [{ key: "keyword", label: "K", type: "text" }] }],
      }).ok,
    ).toBe(true);
  });

  it("refuses an unknown reference, naming it", () => {
    const result = withRunContext({ heading: "Ctx", lines: ["{run.secret}"] });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("runContext");
    expect(reasonOf(result)).toContain("{run.secret}");
  });

  it("refuses a payload key no Mission type declares", () => {
    const result = withRunContext({ heading: "Ctx", lines: ["{payload.nope}"] });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("payload.nope");
  });

  it("accepts a payload key declared in a Mission type's default payload", () => {
    expect(
      withRunContext({ heading: "Ctx", lines: ["{payload.keyword}"] }, {
        missionTypes: [{ type: "make", label: "Make", payload: '{"keyword":""}', agentsMd: "make.md" }],
      }).ok,
    ).toBe(true);
  });

  it("refuses a reference to a password requirement", () => {
    const result = withRunContext(
      { heading: "Ctx", lines: ["{config.apiKey}"] },
      { requirements: [{ key: "apiKey", type: "password", label: "API key", required: true }] },
    );
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("apiKey");
  });

  it.each([
    ["a non-object", "x"],
    ["a blank heading", { heading: " ", lines: ["a"] }],
    ["no lines", { heading: "H" }],
    ["a blank line", { heading: "H", lines: [""] }],
    ["a non-string line", { heading: "H", lines: [1] }],
    ["an unknown key", { heading: "H", lines: ["a"], extra: 1 }],
  ])("refuses %s", (_name, runContext) => {
    expect(withRunContext(runContext).ok).toBe(false);
  });
});

// #670: a package cannot reach platform secrets or anything beyond the Agent's
// own config and the Mission's own payload, even with a hand-written declaration.
describe("run-context interpolation scope", () => {
  const declaration = (line: string) => ({ heading: "H", lines: [line] });
  const render = (line: string, inputs: Partial<Parameters<typeof renderRunContext>[1]> = {}) =>
    renderRunContext(declaration(line), { runId: "r1", config: { domain: "a.com" }, now: NOW, ...inputs });

  it("resolves the Agent's own config and the Mission's own payload", () => {
    expect(render("{config.domain} {payload.topic}", { payload: { topic: "seo" } })).toContain("- a.com seo");
  });

  it.each(["{config.constructor}", "{config.__proto__}", "{config.toString}", "{payload.constructor}", "{payload.__proto__}"])(
    "never resolves an inherited property: %s",
    (line) => {
      expect(render(line, { payload: {} })).toBe("## H\n\n");
    },
  );

  it("never renders the Agent's API key or a declared secret key", () => {
    const inputs = { config: { apiKey: "platform-issued", token: "t0k", domain: "a.com" }, secretConfigKeys: new Set(["token"]) };
    expect(render("{config.apiKey}", inputs)).toBe("## H\n\n");
    expect(render("{config.token}", inputs)).toBe("## H\n\n");
    expect(render("{config.domain}", inputs)).toContain("- a.com");
  });

  it.each(["{env.CONVEX_SECRET}", "{process.env.HOME}", "{agents.other.apiKey}", "{config.a.b}", "{payload}", "{ config.domain }"])(
    "refuses a reference outside the grammar at validation: %s",
    (line) => {
      expect(runContextReferences(line)).toBeInstanceOf(Error);
    },
  );
});
