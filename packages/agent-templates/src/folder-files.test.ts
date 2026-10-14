import { describe, expect, it } from "vitest";
import { filesFromFolder, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, type FolderEntry } from "./folder-files";

const bytesOf = (content: string | Uint8Array) => (typeof content === "string" ? new TextEncoder().encode(content) : content);

/** A picked folder as the browser reports it: paths start with the folder's own name. */
function entry(path: string, content: string | Uint8Array = "x"): FolderEntry {
  const bytes = bytesOf(content);
  return { path, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer };
}

const BASE = [entry("my-agent/package.json", "{}"), entry("my-agent/CLAW.md", "# c"), entry("my-agent/workspace/AGENTS.md", "# a")];

describe("filesFromFolder", () => {
  it("returns the package files with paths relative to the picked folder, sorted", async () => {
    const files = await filesFromFolder([...BASE].reverse());
    expect(files).toEqual([
      { path: "CLAW.md", content: "# c" },
      { path: "package.json", content: "{}" },
      { path: "workspace/AGENTS.md", content: "# a" },
    ]);
  });

  it("skips VCS metadata, dependencies and OS noise at any depth", async () => {
    const files = await filesFromFolder([
      ...BASE,
      entry("my-agent/.git/HEAD"),
      entry("my-agent/node_modules/x/index.js"),
      entry("my-agent/plugins/p/node_modules/y.js"),
      entry("my-agent/.DS_Store"),
    ]);
    expect(files.map((f) => f.path)).toEqual(["CLAW.md", "package.json", "workspace/AGENTS.md"]);
  });

  it("refuses a folder without CLAW.md", async () => {
    await expect(filesFromFolder([entry("my-agent/package.json", "{}")])).rejects.toThrow(/CLAW\.md/);
  });

  it("refuses an empty selection", async () => {
    await expect(filesFromFolder([])).rejects.toThrow(/empty/i);
  });

  it("refuses a binary file, naming it", async () => {
    await expect(
      filesFromFolder([...BASE, entry("my-agent/workspace/logo.png", new Uint8Array([0x89, 0x50, 0xff, 0xfe, 0x00]))]),
    ).rejects.toThrow(/workspace\/logo\.png.*UTF-8 text/);
  });

  it("refuses a file over the size limit before reading it", async () => {
    const big: FolderEntry = {
      path: "my-agent/workspace/big.md",
      size: MAX_FILE_BYTES + 1,
      arrayBuffer: async () => {
        throw new Error("must not be read");
      },
    };
    await expect(filesFromFolder([...BASE, big])).rejects.toThrow(/workspace\/big\.md.*limit/);
  });

  it("refuses a package with too many files", async () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => entry(`my-agent/workspace/f${i}.md`));
    await expect(filesFromFolder([...BASE, ...many])).rejects.toThrow(/files/);
  });

  it("refuses a package over the total size limit before reading it", async () => {
    const unread = (i: number): FolderEntry => ({
      path: `my-agent/workspace/t${i}.md`,
      size: MAX_FILE_BYTES,
      arrayBuffer: async () => {
        throw new Error("must not be read");
      },
    });
    const files = Array.from({ length: Math.ceil(MAX_TOTAL_BYTES / MAX_FILE_BYTES) + 1 }, (_, i) => unread(i));
    await expect(filesFromFolder([...BASE, ...files])).rejects.toThrow(/total/i);
  });
});
