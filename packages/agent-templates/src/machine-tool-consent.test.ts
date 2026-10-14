import { describe, expect, it } from "vitest";
import { ANDROID_TOOL_FIXTURE } from "./__fixtures__/machine-tool.js";
import { describeMachineToolPlan, describeMachineToolUninstall } from "./machine-tool-consent.js";
import { planMachineToolInstall } from "./machine-tool-install.js";

describe("describeMachineToolPlan", () => {
  const text = describeMachineToolPlan(planMachineToolInstall(ANDROID_TOOL_FIXTURE, "/home/u/.opengroow/tools")!);

  it("states the source, the digest and the directory", () => {
    expect(text).toContain(ANDROID_TOOL_FIXTURE.install.source.url);
    expect(text).toContain(ANDROID_TOOL_FIXTURE.install.source.sha256);
    expect(text).toContain("/home/u/.opengroow/tools/android");
  });

  it("lists every command exactly as it will run, quoting arguments with spaces", () => {
    expect(text).toContain("python3 -m venv /home/u/.opengroow/tools/android/engine/.venv");
    expect(text).toContain("tar -xzf /home/u/.opengroow/tools/.android.download/archive.tgz -C /home/u/.opengroow/tools/android");
    const spaced = describeMachineToolPlan({ ...planMachineToolInstall(ANDROID_TOOL_FIXTURE, "/a b")! });
    expect(spaced).toContain("'/a b/android'");
  });

  it("says what is checked first and what happens on failure", () => {
    expect(text).toContain("adb version");
    expect(text).toContain("left unchanged");
  });
});

describe("describeMachineToolUninstall", () => {
  const text = describeMachineToolUninstall(planMachineToolInstall(ANDROID_TOOL_FIXTURE, "/home/u/.opengroow/tools")!);

  it("says that the directory is deleted recursively, not that something is installed", () => {
    expect(text).toContain("Remove");
    expect(text).toContain("/home/u/.opengroow/tools/android");
    expect(text).toContain("deleted");
    expect(text).not.toContain("Install ");
    expect(text).not.toContain("sha256");
    expect(text).not.toContain("tar -xzf");
  });
});
