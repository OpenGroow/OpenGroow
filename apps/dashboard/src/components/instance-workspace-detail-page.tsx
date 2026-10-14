"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { use } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Plus } from "lucide-react";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import type {
  InstanceRecord,
  ParsedWorkspaceFilePayload,
  ParsedWorkspaceListPayload,
  ParsedWorkspaceSkillFilesPayload,
} from "@/src/components/instance-workspace.types";
import type {
  RuntimeWorkspaceDescriptor,
  RuntimeWorkspaceFileEntry,
} from "@opengroow/protocol";
import { WorkspaceMarkdown } from "@/src/components/workspace-markdown";
import { AddSkillDialog } from "@/src/components/add-skill-dialog";
import { AgentSkillsList } from "@/src/components/agent-skills-list";
import { useAuthenticatedInstances } from "@/src/hooks/use-authenticated-instances";
import { useWorkspaceFileRead } from "@/src/hooks/use-workspace-file-read";
import {
  toWorkspaceListPayload,
  toWorkspaceSkillFilesPayload,
  useWorkspaceOperation,
} from "@/src/hooks/use-workspace-operations";
import { mergeTemplatesWithAgents } from "@/src/utils/merge-agent-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type InstanceWorkspaceDetailPageProps = {
  params: Promise<{ instanceId: string; workspaceKey: string }>;
  /** Set when rendered as an Agent page's Files tab: links stay under that Agent. */
  agentTemplateId?: string;
};

// Stable reference so `selectedFilePath`'s memo doesn't re-run on every
// render while no skill is selected (a fresh `[]` literal would defeat it).
const EMPTY_SKILL_FILES: RuntimeWorkspaceFileEntry[] = [];

export function InstanceWorkspaceDetailPage({
  params,
  agentTemplateId,
}: InstanceWorkspaceDetailPageProps) {
  const { instanceId, workspaceKey } = use(params);
  const decodedInstanceId = decodeURIComponent(instanceId);
  const { manifests } = useProjectManifests(decodedInstanceId);
  const decodedWorkspaceKey = decodeURIComponent(workspaceKey);
  const projectPath = `/projects/${encodeURIComponent(decodedInstanceId)}`;
  const agentPath = agentTemplateId ? `${projectPath}/agents/${encodeURIComponent(agentTemplateId)}` : null;
  // Where file selection (`?file=`) lives: the Agent's Files tab, or the Workspace page.
  const workspacePath = `${projectPath}/settings/workspaces/${encodeURIComponent(decodedWorkspaceKey)}`;
  const filesPath = agentPath ? `${agentPath}/files` : workspacePath;
  const searchParams = useSearchParams();
  const router = useRouter();
  const instances = useAuthenticatedInstances<InstanceRecord>();
  const listWorkspaces = useAction(api.workspace_operations_node.listWorkspaces);
  const readWorkspaceFile = useAction(
    api.workspace_operations_node.readWorkspaceFile,
  );
  const listSkillFiles = useAction(api.workspace_operations_node.listSkillFiles);
  const addSkill = useAction(api.project_agents_node.addAgentSkill);

  const instance = instances?.find(
    (entry) =>
      entry.openclawId === decodedInstanceId || entry.jobId === decodedInstanceId,
  );
  const runtimeInstanceId = instance?.openclawId?.trim() ?? "";

  // The Agent whose workspace this is — resolved by matching `workspaceKey`,
  // since this page is keyed by workspace, not by Agent templateId.
  const agentRecords = useQuery(
    api.project_agents.listByInstance,
    runtimeInstanceId ? { instanceId: runtimeInstanceId } : "skip",
  );
  const agentCard = React.useMemo(() => {
    const cards = mergeTemplatesWithAgents(manifests, agentRecords ?? []);
    return cards.find((card) => card.workspaceKey === decodedWorkspaceKey) ?? null;
  }, [manifests, agentRecords, decodedWorkspaceKey]);

  const [addSkillOpen, setAddSkillOpen] = React.useState(false);
  const [skillMessage, setSkillMessage] = React.useState<string | null>(null);

  async function handleAddSkill(spec: string) {
    if (!runtimeInstanceId || !agentCard) return;
    setSkillMessage(null);
    const result = await addSkill({ instanceId: runtimeInstanceId, templateId: agentCard.templateId, spec });
    if (result.status === "installed") {
      return;
    }
    if (result.status === "already_required") {
      setSkillMessage(`"${spec}" is already required and installed by this Agent's Template.`);
      return;
    }
    setSkillMessage(result.errorMessage);
    throw new Error(result.errorMessage);
  }

  // Seed workspace list from Convex cache for instant display.
  const cachedWorkspaces: RuntimeWorkspaceDescriptor[] = React.useMemo(
    () => (instance?.workspaceList?.workspaces as RuntimeWorkspaceDescriptor[] | undefined) ?? [],
    [instance?.workspaceList],
  );

  // ── Reset key allows the Refresh button to re-trigger both commands ──────
  const [resetKey, setResetKey] = React.useState(0);

  // ── Workspace list command ────────────────────────────────────────────────
  const listRequest = React.useMemo(
    () =>
      runtimeInstanceId
        ? { instanceId: runtimeInstanceId, resetKey }
        : null,
    [runtimeInstanceId, resetKey],
  );

  const listResult = useWorkspaceOperation<{}, ParsedWorkspaceListPayload>({
    request: listRequest,
    run: React.useCallback(
      ({ instanceId: id }) =>
        listWorkspaces({ instanceId: id }).then(toWorkspaceListPayload),
      [listWorkspaces],
    ),
  });

  // Use fresh runtime data when available, otherwise show the Convex cache.
  const workspaces: RuntimeWorkspaceDescriptor[] =
    listResult.status === "data" ? listResult.data.workspaces : cachedWorkspaces;

  const workspace = React.useMemo(
    () =>
      workspaces.find((entry) => entry.workspaceKey === decodedWorkspaceKey) ?? null,
    [decodedWorkspaceKey, workspaces],
  );

  // ── Skill files listing (on-demand, triggered by clicking a skill) ───────
  const [selectedSkillSpec, setSelectedSkillSpec] = React.useState<string | null>(null);

  const skillFilesRequest = React.useMemo(
    () =>
      runtimeInstanceId && workspace && selectedSkillSpec
        ? {
            instanceId: runtimeInstanceId,
            workspaceKey: workspace.workspaceKey,
            spec: selectedSkillSpec,
            resetKey,
          }
        : null,
    [runtimeInstanceId, workspace, selectedSkillSpec, resetKey],
  );

  const skillFilesResult = useWorkspaceOperation<
    { workspaceKey: string; spec: string },
    ParsedWorkspaceSkillFilesPayload
  >({
    request: skillFilesRequest,
    run: React.useCallback(
      ({ instanceId: id, workspaceKey: wk, spec }) =>
        listSkillFiles({ instanceId: id, workspaceKey: wk, spec }).then(
          toWorkspaceSkillFilesPayload,
        ),
      [listSkillFiles],
    ),
  });

  const skillFiles: RuntimeWorkspaceFileEntry[] =
    skillFilesResult.status === "data" ? skillFilesResult.data.files : EMPTY_SKILL_FILES;
  const loadingSkillFiles = skillFilesResult.status === "loading";
  const skillFilesError =
    skillFilesResult.status === "error" ? skillFilesResult.error : null;

  function handleSelectSkill(spec: string) {
    setSelectedSkillSpec((current) => (current === spec ? null : spec));
  }

  const selectedFilePath = React.useMemo(
    () => resolveSelectedFilePath(workspace, skillFiles, searchParams.get("file")),
    [searchParams, workspace, skillFiles],
  );

  // ── Workspace file read command ───────────────────────────────────────────
  const fileRequest = React.useMemo(
    () =>
      runtimeInstanceId && workspace && selectedFilePath
        ? {
            instanceId: runtimeInstanceId,
            workspaceKey: workspace.workspaceKey,
            filePath: selectedFilePath,
            resetKey,
          }
        : null,
    [runtimeInstanceId, workspace, selectedFilePath, resetKey],
  );

  const fileResult = useWorkspaceFileRead({
    request: fileRequest,
    read: React.useCallback(
      ({ instanceId, workspaceKey: wk, filePath }) =>
        readWorkspaceFile({ instanceId, workspaceKey: wk, filePath }),
      [readWorkspaceFile],
    ),
  });

  const fileData: ParsedWorkspaceFilePayload | null =
    fileResult.status === "data" ? fileResult.data : null;

  const standardFiles = React.useMemo(
    () => workspace?.availableFiles.filter((file) => file.kind === "standard") ?? [],
    [workspace],
  );
  const memoryFiles = React.useMemo(
    () => workspace?.availableFiles.filter((file) => file.kind === "memory") ?? [],
    [workspace],
  );

  // Derived booleans that map hook status → loading/error UI
  const loadingList = listResult.status === "loading";
  const loadingFile = fileResult.status === "loading";
  // True only when the user triggered the refresh (resetKey > 0), not on initial auto-load.
  const userRefreshing = resetKey > 0 && (loadingList || loadingFile);
  const listError = listResult.status === "error" ? listResult.error : null;
  const fileError = fileResult.status === "error" ? fileResult.error : null;
  const workspaceListLoaded = listResult.status === "data";

  const activeFileKey =
    fileData && fileData.workspaceKey && fileData.filePath
      ? `${fileData.workspaceKey}:${fileData.filePath}`
      : "";

  const requestedFileKey =
    workspace && selectedFilePath
      ? `${workspace.workspaceKey}:${selectedFilePath}`
      : "";

  if (!instance) {
    return null;
  }

  if (!runtimeInstanceId) {
    return (
      <section className="grid gap-6">
        <DetailHeader />
        <WorkspaceStatePanel
          title="Workspace unavailable"
          description="This Project has no linked OpenClaw runtime yet, so no workspace can be queried."
        />
      </section>
    );
  }

  if (listError) {
    return (
      <section className="grid gap-6">
        <DetailHeader />
        <WorkspaceStatePanel title="Could not load workspaces" description={listError} tone="error" />
      </section>
    );
  }

  if (!workspaceListLoaded && cachedWorkspaces.length === 0) {
    return (
      <section className="grid gap-6">
        <DetailHeader />
        <WorkspaceStatePanel
          title="Loading workspace"
          description="Querying the runtime for this Project workspaces."
        />
      </section>
    );
  }

  if (!workspace) {
    return (
      <section className="grid gap-6">
        <DetailHeader />
        <WorkspaceStatePanel
          title="Workspace not found"
          description="The requested workspace key is not available on this runtime."
        />
      </section>
    );
  }

  return (
    <section className="grid gap-8">
      <DetailHeader
        action={
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => {
                setResetKey((k) => k + 1);
              }}
              disabled={userRefreshing}
              className="h-11 rounded-xl bg-[rgba(220,230,224,0.66)] px-5 text-[var(--dashboard-primary)] hover:bg-[rgba(220,230,224,0.82)]"
            >
              {userRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
            {agentCard?.status === "active" ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl"
                onClick={() => {
                  setSkillMessage(null);
                  setAddSkillOpen(true);
                }}
              >
                <span className="flex items-center gap-2">
                  <Plus className="size-4" />
                  Add Skill
                </span>
              </Button>
            ) : null}
            {agentPath ? null : (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl"
                onClick={() => {
                  router.push(`${projectPath}/settings/workspaces`);
                }}
              >
                Back to Workspaces
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="rounded-[1.7rem] border-0 bg-[#fbfcfa] py-4 shadow-[inset_0_0_0_1px_rgba(0,38,27,0.08)]">
          <CardContent className="grid gap-6 overflow-x-auto overflow-y-hidden px-5">
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[rgba(220,230,224,0.5)] px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                  {workspace.kind}
                </span>
                {workspace.isActive ? (
                  <span className="rounded-full bg-[rgba(188,237,215,0.7)] px-3 py-1 text-[0.72rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-primary)]">
                    Active
                  </span>
                ) : null}
              </div>
              <h2 className="m-0 text-[1.3rem] leading-[1.08] tracking-[-0.04em] text-[var(--dashboard-ink)]">
                {workspace.label}
              </h2>
              <p className="m-0 text-sm leading-6 text-[var(--dashboard-ink-muted)]">
                <code>{workspace.absolutePath}</code>
              </p>
            </div>

            {agentCard?.skills && agentCard.skills.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="m-0 text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
                  Agent Skills
                </h3>
                <AgentSkillsList
                  skills={agentCard.skills}
                  selectedSpec={selectedSkillSpec}
                  onSelectSkill={handleSelectSkill}
                />
                {selectedSkillSpec && skillFilesError ? (
                  <p className="m-0 text-sm text-[var(--dashboard-tertiary)]">
                    {skillFilesError}
                  </p>
                ) : null}
                {selectedSkillSpec && !skillFilesError && loadingSkillFiles ? (
                  <p className="m-0 text-sm text-[var(--dashboard-ink-muted)]">
                    Loading files…
                  </p>
                ) : null}
                {selectedSkillSpec && !skillFilesError && !loadingSkillFiles ? (
                  <WorkspaceFileSection
                    title={`Files in "${selectedSkillSpec}"`}
                    files={skillFiles}
                    activeFilePath={selectedFilePath}
                    basePath={filesPath}
                  />
                ) : null}
              </div>
            ) : null}

            {skillMessage ? (
              <p className="m-0 rounded-xl bg-[rgba(0,38,27,0.05)] px-4 py-3 text-[0.9rem] leading-6 text-[var(--dashboard-ink-muted)]">
                {skillMessage}
              </p>
            ) : null}

            <WorkspaceFileSection
              title="Workspace files"
              files={standardFiles}
              activeFilePath={selectedFilePath}
              basePath={filesPath}
            />

            <WorkspaceFileSection
              title="Daily memory"
              files={memoryFiles}
              activeFilePath={selectedFilePath}
              basePath={filesPath}
            />
          </CardContent>
        </Card>

        <Card className="rounded-[1.8rem] border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,247,246,0.92))] py-4 shadow-[var(--dashboard-shadow)]">
          <CardHeader className="grid gap-2 px-6 pb-0">
            <CardTitle className="text-[1.45rem] leading-[1.08] tracking-[-0.04em] text-[var(--dashboard-ink)]">
              {fileData?.title || selectedFilePath || "Workspace file"}
            </CardTitle>
            {selectedFilePath ? (
              <p className="m-0 text-sm leading-6 text-[var(--dashboard-ink-muted)]">
                <code>{selectedFilePath}</code>
                {fileData?.lastModifiedAt
                  ? ` · Updated ${new Date(fileData.lastModifiedAt).toLocaleString()}`
                  : ""}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4 overflow-x-auto overflow-y-hidden px-6 pt-5">
            {fileError ? (
              <WorkspaceStatePanel
                title="Could not load this file"
                description={fileError}
                tone="error"
              />
            ) : null}

            {!fileError && loadingFile && activeFileKey !== requestedFileKey ? (
              <WorkspaceStatePanel
                title="Loading file"
                description="Reading the selected Markdown file from the runtime workspace."
              />
            ) : null}

            {!fileError && !loadingFile && !selectedFilePath ? (
              <WorkspaceStatePanel
                title="No files available"
                description="This workspace does not expose any standard Markdown files yet."
              />
            ) : null}

            {!fileError &&
            selectedFilePath &&
            fileData &&
            activeFileKey === requestedFileKey ? (
              <WorkspaceMarkdown content={fileData.content} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {agentCard ? (
        <AddSkillDialog
          agentName={agentCard.manifest.name}
          open={addSkillOpen}
          onOpenChange={setAddSkillOpen}
          onSubmit={handleAddSkill}
        />
      ) : null}
    </section>
  );
}

function resolveSelectedFilePath(
  workspace: RuntimeWorkspaceDescriptor | null,
  skillFiles: RuntimeWorkspaceFileEntry[],
  requestedFilePath: string | null,
): string | null {
  if (!workspace) {
    return null;
  }

  const available = new Set([
    ...workspace.availableFiles.map((file) => file.filePath),
    ...skillFiles.map((file) => file.filePath),
  ]);
  const trimmedRequested = requestedFilePath?.trim();
  if (trimmedRequested && available.has(trimmedRequested)) {
    return trimmedRequested;
  }

  return (
    workspace.availableFiles.find((file) => file.filePath === "AGENTS.md")?.filePath ??
    workspace.availableFiles[0]?.filePath ??
    null
  );
}

function DetailHeader({ action }: { action?: React.ReactNode }) {
  return (
    <header className="flex flex-col items-start justify-between gap-5 lg:flex-row lg:items-center">
      <div className="grid gap-2">
        <span className="text-[0.78rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
          Runtime Workspace
        </span>
        <h1 className="m-0 text-[clamp(2.2rem,4vw,3.6rem)] leading-[0.98] tracking-[-0.06em] text-[var(--dashboard-primary)]">
          Workspace Files
        </h1>
        <p className="m-0 max-w-3xl text-[1rem] leading-7 text-[var(--dashboard-ink-muted)]">
          Inspect the standard Markdown files exposed by the selected OpenClaw workspace.
        </p>
      </div>
      {action}
    </header>
  );
}

function WorkspaceFileSection({
  title,
  files,
  activeFilePath,
  basePath,
}: {
  title: string;
  files: RuntimeWorkspaceFileEntry[];
  activeFilePath: string | null;
  basePath: string;
}) {
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-[0.8rem] font-bold uppercase tracking-[0.16em] text-[var(--dashboard-ink-soft)]">
        {title}
      </h3>
      <div className="grid gap-1.5">
        {files.length === 0 ? (
          <p className="m-0 text-sm text-[var(--dashboard-ink-muted)]">None</p>
        ) : (
          files.map((file) => (
            <Link
              key={file.filePath}
              href={`${basePath}?file=${encodeURIComponent(file.filePath)}`}
              className={cn(
                "flex min-h-11 items-center rounded-xl px-3 py-2 text-sm transition-[background-color,color] duration-150",
                activeFilePath === file.filePath
                  ? "bg-[linear-gradient(135deg,rgba(188,237,215,0.92),rgba(214,236,226,0.88))] text-[var(--dashboard-primary)]"
                  : "text-[var(--dashboard-ink-muted)] hover:bg-[rgba(220,230,224,0.62)] hover:text-[var(--dashboard-ink)]",
              )}
            >
              {file.filePath}
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

function WorkspaceStatePanel({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "error";
}) {
  return (
    <Card
      className={cn(
        "rounded-[1.5rem] border-0 py-4 shadow-none",
        tone === "error" ? "bg-[rgba(84,41,37,0.06)]" : "bg-[rgba(220,230,224,0.22)]",
      )}
    >
      <CardContent className="grid gap-2 px-5">
        <h3 className="m-0 text-[1.05rem] leading-[1.08] tracking-[-0.03em] text-[var(--dashboard-ink)]">
          {title}
        </h3>
        <p className="m-0 text-[0.96rem] leading-7 text-[var(--dashboard-ink-muted)]">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}
