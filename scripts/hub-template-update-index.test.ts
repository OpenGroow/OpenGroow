import { describe, expect, it } from "vitest";
// @ts-ignore plain ESM script shipped in hub-template/ (copied to the hub repository), no declarations
import { updateIndex } from "../hub-template/tools/update-index.mjs";
import { parseHubIndex } from "../packages/agent-templates/src/hub-index.js";

const DIGEST = `sha256:${"b".repeat(64)}`;
const OLD = `sha256:${"a".repeat(64)}`;
const entry = {
  id: "@opengroow/source",
  name: "Source",
  description: "Collects sources",
  repository: "OpenGroow/groowhub",
  tag: "source@1.0.0",
  asset: "opengroow-source-1.0.0.tgz",
  digest: OLD,
  category: "system",
  verification: "official",
};
const index = { schemaVersion: 1, packages: [entry] };
const release = {
  id: "@opengroow/source",
  repository: "OpenGroow/groowhub",
  tag: "source@1.1.0",
  asset: "opengroow-source-1.1.0.tgz",
  digest: DIGEST,
};

describe("updateIndex", () => {
  it("points the entry at the new release and keeps the maintainers' fields", () => {
    const updated = updateIndex(index, release);
    expect(updated.packages[0]).toEqual({ ...entry, tag: "source@1.1.0", asset: "opengroow-source-1.1.0.tgz", digest: DIGEST });
    expect(parseHubIndex(updated).ok).toBe(true);
  });

  it("does not mutate its input", () => {
    updateIndex(index, release);
    expect(index.packages[0]!.digest).toBe(OLD);
  });

  it("refuses a package with no entry: the trust level is a human decision", () => {
    expect(() => updateIndex(index, { ...release, id: "@opengroow/seo" })).toThrow(/no entry/i);
  });

  it("produces an index the OpenGroow parser refuses when the asset is not a .tgz", () => {
    expect(parseHubIndex(updateIndex(index, { ...release, asset: "x.zip" })).ok).toBe(false);
  });
});
