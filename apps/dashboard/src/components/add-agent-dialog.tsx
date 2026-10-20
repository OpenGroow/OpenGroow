"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { AgentManifest, InstallationPlan } from "@convex/template_manifest_contract";
import { AddFromFolderButton, type LocalFolderChoice } from "@/src/components/add-from-folder-button";
import { CatalogueItem, PlanActivationDialog, type Verification } from "@/src/components/add-agent-parts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CatalogueEntry = FunctionReturnType<typeof api.project_templates.catalogue>[number];
type HubCatalogue = FunctionReturnType<typeof api.project_templates_node.hubCatalogue>;
type HubEntry = HubCatalogue["entries"][number];

const ORIGIN_LABELS: Record<CatalogueEntry["origin"], string> = {
  local_folder: "Local folder",
  linked_folder: "Linked folder",
  git: "Git",
  hub: "Hub",
};

/** An installed Template is trusted as the hub rates it, when the hub lists it. */
function trustOf(entry: CatalogueEntry, hubEntries: readonly HubEntry[]): Verification | null {
  const listed = hubEntries.find((hubEntry) => hubEntry.templateId === entry.templateId);
  return listed ? listed.verification : null;
}

type HubChoice = { templateId: string; manifest: AgentManifest; plan: InstallationPlan };

type AddAgentDialogProps = {
  projectId: string;
  /** The Project's runtime (Instance) id; hub and folder installs need it. */
  instanceId: string | null;
  /** Self-hosted deployment: offers adding an Agent from a local folder (#707). */
  selfHost?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Installs and activates the Agent; rejects with the reason when it fails. */
  onAdd: (templateId: string, userConfig: Record<string, string>) => Promise<void>;
};

export function AddAgentDialog({ projectId, instanceId, selfHost = false, open, onOpenChange, onAdd }: AddAgentDialogProps) {
  const catalogue = useQuery(api.project_templates.catalogue, open ? { projectId } : "skip");
  const loadHubCatalogue = useAction(api.project_templates_node.hubCatalogue);
  const previewHubTemplate = useAction(api.project_templates_node.previewHubTemplate);
  const installHubTemplate = useAction(api.project_templates_node.installHubTemplate);
  const installLocalFolder = useAction(api.project_templates_node.installLocalFolder);

  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const [hub, setHub] = React.useState<HubCatalogue | undefined>(undefined);
  const [hubChoice, setHubChoice] = React.useState<HubChoice | null>(null);
  const [folderChoice, setFolderChoice] = React.useState<LocalFolderChoice | null>(null);
  const [previewing, setPreviewing] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  const loadHubRef = React.useRef(loadHubCatalogue);
  loadHubRef.current = loadHubCatalogue;
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadHubRef
      .current({})
      .then((result) => {
        if (!cancelled) setHub(result ?? { entries: [] });
      })
      .catch((error: unknown) => {
        if (!cancelled) setHub({ entries: [], error: error instanceof Error ? error.message : "Could not read the hub" });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chosen = catalogue?.find((entry) => entry.templateId === chosenId);

  function close(next: boolean) {
    if (!next) {
      setChosenId(null);
      setHubChoice(null);
      setFolderChoice(null);
      setPreviewError(null);
    }
    onOpenChange(next);
  }

  async function chooseHubEntry(templateId: string) {
    if (!instanceId) {
      setPreviewError("This Project's runtime is not ready yet.");
      return;
    }
    setPreviewError(null);
    setPreviewing(templateId);
    try {
      const preview = await previewHubTemplate({ instanceId, templateId });
      if (preview.status === "error") setPreviewError(preview.errorMessage);
      else setHubChoice({ templateId, manifest: preview.manifest, plan: preview.plan });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Could not read the package");
    } finally {
      setPreviewing(null);
    }
  }

  async function addHubEntry(choice: HubChoice, userConfig: Record<string, string>) {
    if (!instanceId) throw new Error("This Project's runtime is not ready yet.");
    // The package is downloaded again and verified against the hub's recorded digest at install time.
    const installed = await installHubTemplate({ instanceId, templateId: choice.templateId });
    if (installed.status === "error") throw new Error(installed.errorMessage);
    await onAdd(choice.templateId, userConfig);
  }

  async function addFolder(choice: LocalFolderChoice, userConfig: Record<string, string>) {
    if (!instanceId) throw new Error("This Project's runtime is not ready yet.");
    const installed = await installLocalFolder({ instanceId, files: choice.files });
    if (installed.status === "error") throw new Error(installed.errorMessage);
    await onAdd(choice.manifest.id, userConfig);
  }

  if (open && chosen) {
    return <PlanActivationDialog choice={chosen} onOpenChange={close} onSubmit={(userConfig) => onAdd(chosen.templateId, userConfig)} />;
  }

  if (open && folderChoice) {
    return <PlanActivationDialog choice={folderChoice} onOpenChange={close} onSubmit={(userConfig) => addFolder(folderChoice, userConfig)} />;
  }

  if (open && hubChoice) {
    return <PlanActivationDialog choice={hubChoice} onOpenChange={close} onSubmit={(userConfig) => addHubEntry(hubChoice, userConfig)} />;
  }

  const hubEntries = hub?.entries ?? [];
  const available = (catalogue ?? []).filter((entry) => !entry.added);
  const knownIds = new Set((catalogue ?? []).map((entry) => entry.templateId));
  const hubAvailable = hubEntries.filter((entry) => !knownIds.has(entry.templateId));
  const nothingToAdd = available.length === 0 && hubAvailable.length === 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
          <DialogDescription>Choose an agent template to add to this Project.</DialogDescription>
        </DialogHeader>
        {selfHost ? (
          <AddFromFolderButton
            instanceId={instanceId}
            onChosen={(choice) => {
              setPreviewError(null);
              setFolderChoice(choice);
            }}
            onError={setPreviewError}
          />
        ) : null}
        {hub?.error ? (
          <p role="alert" className="m-0 text-sm text-muted-foreground">
            The hub catalogue could not be read: {hub.error}
          </p>
        ) : null}
        {previewError ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            {previewError}
          </p>
        ) : null}
        {catalogue === undefined ? (
          <p className="m-0 text-sm text-muted-foreground">Loading catalogue…</p>
        ) : nothingToAdd && hub?.error ? (
          <p className="m-0 text-sm text-muted-foreground">
            No agent template is available while the hub cannot be reached. Retry later, or add one from a local folder
            with <code>pnpm template:add &lt;folder&gt; --project {instanceId ?? "&lt;projectId&gt;"}</code>.
          </p>
        ) : nothingToAdd ? (
          <p className="m-0 text-sm text-muted-foreground">
            Every available agent template is already in this Project.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {available.map((entry) => {
              const trust = trustOf(entry, hubEntries);
              return (
                <CatalogueItem
                  key={entry.templateId}
                  name={entry.manifest.name}
                  description={entry.manifest.description}
                  meta={`${ORIGIN_LABELS[entry.origin]} · v${entry.version}`}
                  trust={trust}
                  onChoose={() => setChosenId(entry.templateId)}
                />
              );
            })}
            {hubAvailable.map((entry) => (
              <CatalogueItem
                key={entry.templateId}
                name={entry.name}
                description={entry.description}
                meta={`${ORIGIN_LABELS.hub} · ${entry.category} · ${entry.tag}`}
                trust={entry.verification}
                busy={previewing === entry.templateId}
                onChoose={() => void chooseHubEntry(entry.templateId)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

