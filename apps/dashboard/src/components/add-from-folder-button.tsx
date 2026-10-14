"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { FolderOpen } from "lucide-react";
import { api } from "@convex/_generated/api";
import { filesFromFolder, type AgentManifest, type FolderEntry, type InstallationPlan } from "@convex/template_manifest_contract";
import { Button } from "@/components/ui/button";

export type LocalFolderChoice = {
  manifest: AgentManifest;
  plan: InstallationPlan;
  files: { path: string; content: string }[];
};

type AddFromFolderButtonProps = {
  /** The Project's runtime (Instance) id. */
  instanceId: string | null;
  /** The folder is valid: its manifest and installation plan, ready to confirm. */
  onChosen: (choice: LocalFolderChoice) => void;
  /** The folder was refused, with the reason. */
  onError: (message: string) => void;
};

/**
 * "Add from a local folder" (#707, self-host only): reads the picked folder in
 * the browser (the server may not see the owner's disk), checks it, and asks
 * the server for its installation plan. Nothing is installed here.
 */
export function AddFromFolderButton({ instanceId, onChosen, onError }: AddFromFolderButtonProps) {
  const previewLocalFolder = useAction(api.project_templates_node.previewLocalFolder);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (!instanceId) {
      onError("This Project's runtime is not ready yet.");
      return;
    }
    setBusy(true);
    try {
      const entries: FolderEntry[] = picked.map((file) => ({
        path: file.webkitRelativePath,
        size: file.size,
        arrayBuffer: () => file.arrayBuffer(),
      }));
      const files = await filesFromFolder(entries);
      const preview = await previewLocalFolder({ instanceId, files });
      if (preview.status === "error") onError(preview.errorMessage);
      else onChosen({ manifest: preview.manifest, plan: preview.plan, files });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not read the folder");
    } finally {
      setBusy(false);
      // Picking the same folder again (after fixing it) must fire a change.
      if (event.target) event.target.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        aria-label="Template package folder"
        onChange={(event) => void onPick(event)}
        {...{ webkitdirectory: "" }}
      />
      <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
        <FolderOpen aria-hidden="true" />
        Add from a local folder
      </Button>
    </>
  );
}
