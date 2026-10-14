import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeMachineToolPorts } from "./machine-tool-node-ports.js";

describe("nodeMachineToolPorts", () => {
  it("runs an argv without a shell and reports exit code and output", async () => {
    const ports = nodeMachineToolPorts(mkdtempSync(join(tmpdir(), "tools-")));
    expect(await ports.run([process.execPath, "-e", "console.log('$HOME;hi')"])).toEqual({ code: 0, output: "$HOME;hi\n" });
    expect((await ports.run([process.execPath, "-e", "process.exit(3)"])).code).toBe(3);
    expect((await ports.run(["definitely-not-a-command-726"])).code).toBe(127);
  });

  it("writes, renames and removes files", async () => {
    const root = mkdtempSync(join(tmpdir(), "tools-"));
    const { fs } = nodeMachineToolPorts(root);
    await fs.mkdir(join(root, "a"));
    await fs.write(join(root, "a", "f"), new TextEncoder().encode("x"));
    await fs.rename(join(root, "a"), join(root, "b"));
    expect(readFileSync(join(root, "b", "f"), "utf-8")).toBe("x");
    expect(await fs.exists(join(root, "b"))).toBe(true);
    await fs.remove(join(root, "b"));
    await fs.remove(join(root, "b"));
    expect(existsSync(join(root, "b"))).toBe(false);
  });
});
