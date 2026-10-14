import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findViolations } from "./check-dashboard-provider-auth.mjs";

// Architecture guard test for issue #392 — proves that neither
// providers-page-content.tsx nor burst-instance-panel.tsx has its own
// manual Auth polling / authJobs-style state, and that both consume the
// shared useProviderAuth() hook.

describe("check-dashboard-provider-auth", () => {
  it("passes against the real repo state", async () => {
    const violations = await findViolations();
    expect(violations).toEqual([]);
  });

  describe("against a synthetic fixture", () => {
    let cwd: string;

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    function writeGuardedFile(relativePath: string, content: string) {
      const fullPath = join(cwd, relativePath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content);
    }

    function setupFixtureRoot() {
      cwd = mkdtempSync(join(tmpdir(), "check-dashboard-provider-auth-"));
      mkdirSync(join(cwd, "apps/dashboard/app"), { recursive: true });
      mkdirSync(join(cwd, "apps/dashboard/src/components"), { recursive: true });
    }

    it("flags a component that still owns its own authJobs state", async () => {
      setupFixtureRoot();
      writeGuardedFile(
        "apps/dashboard/src/components/providers-page-content.tsx",
        `"use client";\nimport { useState } from "react";\nexport function ProvidersPageContent() {\n  const [authJobs, setAuthJobs] = useState({});\n  return null;\n}\n`,
      );
      writeGuardedFile(
        "apps/dashboard/src/components/burst-instance-panel.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function BurstInstancePanel() {\n  useProviderAuth(undefined, {} as never);\n  return null;\n}\n`,
      );

      const violations = await findViolations(cwd);
      expect(violations.some((v) => v.includes("providers-page-content.tsx"))).toBe(true);
    });

    // The fixture still imports and calls useProviderAuth, so the only rule
    // that can flag it is the manual-polling one — otherwise this test would
    // pass on the "does not use the shared hook" violation instead.
    it("flags a component with a manual setInterval + getAuthJob poll", async () => {
      setupFixtureRoot();
      writeGuardedFile(
        "apps/dashboard/src/components/providers-page-content.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function ProvidersPageContent() {\n  useProviderAuth(undefined, {} as never);\n  return null;\n}\n`,
      );
      writeGuardedFile(
        "apps/dashboard/src/components/burst-instance-panel.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function BurstInstancePanel() {\n  useProviderAuth(undefined, {} as never);\n  window.setInterval(() => {\n    poll();\n  }, 4000);\n  async function poll() {\n    await getAuthJob({});\n  }\n  return null;\n}\n`,
      );

      const violations = await findViolations(cwd);
      expect(violations.some((v) => v.includes("burst-instance-panel.tsx"))).toBe(true);
    });

    it("flags a component whose poll function is defined before the interval", async () => {
      setupFixtureRoot();
      writeGuardedFile(
        "apps/dashboard/src/components/providers-page-content.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function ProvidersPageContent() {\n  useProviderAuth(undefined, {} as never);\n  const poll = () => {\n    void getAuthJob({});\n  };\n  const interval = window.setInterval(poll, 4000);\n  return null;\n}\n`,
      );
      writeGuardedFile(
        "apps/dashboard/src/components/burst-instance-panel.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function BurstInstancePanel() {\n  useProviderAuth(undefined, {} as never);\n  return null;\n}\n`,
      );

      const violations = await findViolations(cwd);
      expect(violations.some((v) => v.includes("providers-page-content.tsx"))).toBe(true);
    });

    it("passes a fixture where both components only use the shared hook", async () => {
      setupFixtureRoot();
      writeGuardedFile(
        "apps/dashboard/src/components/providers-page-content.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function ProvidersPageContent() {\n  useProviderAuth(undefined, {} as never);\n  return null;\n}\n`,
      );
      writeGuardedFile(
        "apps/dashboard/src/components/burst-instance-panel.tsx",
        `"use client";\nimport { useProviderAuth } from "@/src/hooks/use-provider-auth";\nexport function BurstInstancePanel() {\n  useProviderAuth(undefined, {} as never);\n  return null;\n}\n`,
      );

      const violations = await findViolations(cwd);
      expect(violations).toEqual([]);
    });
  });
});
