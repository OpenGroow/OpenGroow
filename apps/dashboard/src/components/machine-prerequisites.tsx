"use client";

import type { InstallationPlan } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";

export type MachinePrerequisiteItem = InstallationPlan["prerequisites"][number];

/**
 * The Tools an Agent needs on the user's own machine, with the exact command
 * to install them (#736). OpenGroow installs nothing and cannot tell what is
 * already installed, so there is no "installed" state here.
 */
export function MachinePrerequisiteList({ prerequisites }: { prerequisites: MachinePrerequisiteItem[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 text-sm text-foreground">
      {prerequisites.map((prerequisite) => (
        <li key={prerequisite.name} className="grid gap-1.5">
          <span>
            {prerequisite.name}
            {prerequisite.minVersion ? ` (version ${prerequisite.minVersion} or later)` : ""}
            {" — "}
            <a href={prerequisite.instructionsUrl} target="_blank" rel="noreferrer noopener" className="underline">
              Instructions
            </a>
          </span>
          {prerequisite.installCommand ? (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-1.5 text-sm">
                {prerequisite.installCommand}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Copy the install command of ${prerequisite.name}`}
                onClick={() => void navigator.clipboard.writeText(prerequisite.installCommand ?? "")}
              >
                Copy
              </Button>
            </div>
          ) : null}
          {prerequisite.externalPrerequisites?.length ? (
            <ul className="m-0 grid list-none gap-0.5 p-0 pl-3 text-muted-foreground">
              {prerequisite.externalPrerequisites.map((external) => (
                <li key={external.name}>
                  Also needs {external.name}
                  {" — "}
                  <a href={external.instructionsUrl} target="_blank" rel="noreferrer noopener" className="underline">
                    Instructions
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
