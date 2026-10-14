import { describe, expect, it } from "vitest";
import { parseDockerEventLine } from "../src/docker-event-watcher.js";

describe("parseDockerEventLine", () => {
  it("reads a Docker container start event", () => {
    expect(parseDockerEventLine('{"status":"start","id":"broker"}')).toEqual({
      status: "start",
      id: "broker",
    });
  });

  it("ignores malformed and non-object output", () => {
    expect(parseDockerEventLine("not json")).toBeNull();
    expect(parseDockerEventLine("null")).toBeNull();
    expect(parseDockerEventLine("[]")).toBeNull();
  });
});
