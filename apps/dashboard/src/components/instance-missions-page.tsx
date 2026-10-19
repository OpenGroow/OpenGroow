"use client";

import { use, useEffect, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AutoPublishToggle, supportsAutoPublish } from "./auto-publish-toggle";
import { COLUMNS, columnForMission, MissionKanbanBoard } from "./mission-kanban-board";
import { MissionPayloadEditor } from "./mission-payload-editor";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import {
  missionTypesForManifest,
  validateMissionPayloadUnlessRaw,
  visibleMissionTypes,
} from "@/src/utils/mission-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/opengroow/page-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CountTile } from "@/components/opengroow/count-tile";
import { SearchField } from "@/components/opengroow/filter-bar";
import { ChevronDown, Plus, Sparkles } from "lucide-react";

type Props = {
  params: Promise<{ instanceId: string }>;
};

const DONE_PAGE_SIZE = 5;

export function InstanceMissionsPage({ params }: Props) {
  const { instanceId } = use(params);
  return <InstanceMissionsContent instanceId={decodeURIComponent(instanceId)} />;
}

export function InstanceMissionsContent({ instanceId }: { instanceId: string }) {
  const { manifests, loading: manifestsLoading } = useProjectManifests(instanceId);
  const agents = useQuery(api.project_agents.listByInstance, { instanceId });
  const missions = useQuery(api.missions.listActiveByInstance, { instanceId });
  const {
    results: doneMissions,
    status: doneStatus,
    loadMore: loadMoreDone,
  } = usePaginatedQuery(api.missions.listDoneByInstance, { instanceId }, { initialNumItems: DONE_PAGE_SIZE });
  const createMission = useMutation(api.missions.create);

  // Agents that only run Jobs (e.g. `source`) declare `jobTypes` but no
  // `missionTypes`: there is nothing to create a Mission for.
  const runningAgents = agents?.filter((a) => a.status === "active") ?? [];
  const activeAgents = runningAgents.filter((a) => {
    const manifest = manifests.find((m) => m.id === a.templateId);
    return !(manifest?.jobTypes?.length && !manifest.missionTypes?.length);
  });

  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const [rawPayloadMode, setRawPayloadMode] = useState(false);
  const [autoPublish, setAutoPublish] = useState(false);
  // null = follow the default: open when the Mission type declares payload
  // fields (the form must be visible), collapsed for a plain JSON payload.
  const [payloadOpenOverride, setPayloadOpenOverride] = useState<boolean | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const effectiveTemplateId = templateId || activeAgents[0]?.templateId || "";
  const effectiveManifest = manifests.find((m) => m.id === effectiveTemplateId);
  const hiddenMissionTypes = activeAgents.find((a) => a.templateId === effectiveTemplateId)?.hiddenMissionTypes;
  const declaredMissionTypes = effectiveManifest ? missionTypesForManifest(effectiveManifest) : [];
  const missionTypes = visibleMissionTypes(declaredMissionTypes, hiddenMissionTypes);
  // Every declared type is hidden: do not fall back to the free-text Type
  // input, it would let the user submit exactly the types that were hidden.
  const allTypesHidden = declaredMissionTypes.length > 0 && missionTypes.length === 0;
  // Re-seed the type/payload when the Agent's deny-list changes while the form
  // is mounted, so a type that just became hidden cannot stay selected.
  const hiddenKey = (hiddenMissionTypes ?? []).join("\u0000");
  // Manifests load after the Agent list: re-seed once the declared types arrive.
  const declaredKey = declaredMissionTypes.map((t) => t.type).join("\u0000");
  const payloadOpen =
    payloadOpenOverride ?? (missionTypes.find((t) => t.type === type)?.fields?.length ?? 0) > 0;
  const setPayloadOpen = setPayloadOpenOverride;
  const autoPublishAllowed = supportsAutoPublish(manifests, effectiveTemplateId, type.trim());

  useEffect(() => {
    // When the agent changes, default to its first known mission type (and its
    // payload). Unknown templates have no preset, so the type falls back to a
    // free-text input with an empty payload.
    const [firstType] = missionTypes;
    setType(firstType?.type ?? "");
    setPayloadText(firstType?.payload ?? "");
    // A new template may not support autoPublish for its default mission
    // type — reset rather than carry a stale toggle across templates.
    setAutoPublish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTemplateId, hiddenKey, declaredKey]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let payload: unknown = {};
    if (payloadText.trim()) {
      try {
        payload = JSON.parse(payloadText) as unknown;
      } catch {
        setError("Payload must be valid JSON.");
        return;
      }
    }

    const selectedTemplateId = templateId || activeAgents[0]?.templateId;
    if (!selectedTemplateId) {
      setError("No active agent available.");
      return;
    }
    if (!type.trim()) {
      setError("Type is required.");
      return;
    }
    const payloadError = validateMissionPayloadUnlessRaw({
      missionTypes: declaredMissionTypes,
      type: type.trim(),
      payload,
      rawMode: rawPayloadMode,
    });
    if (payloadError) {
      setError(payloadError);
      return;
    }

    setSubmitting(true);
    try {
      await createMission({
        instanceId,
        templateId: selectedTemplateId,
        type: type.trim(),
        payload,
        name: name.trim(),
        // Only sent when opted in — an unchecked box leaves the field absent
        // rather than persisting an explicit `false`.
        ...(autoPublishAllowed && autoPublish ? { autoPublish: true } : {}),
      });
      setCreateOpen(false);
      setName("");
      setAutoPublish(false);
      const [firstType] = missionTypes;
      setType(firstType?.type ?? "");
      setPayloadText(firstType?.payload ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create mission.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Missions"
        description="Goals, outcomes, review and progress."
        action={
          <Button variant="glow" size="lg" type="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            Create Mission
          </Button>
        }
      />

      {missions !== undefined && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.filter((col) => col.id !== "blocked" && col.id !== "done").map((col) => (
            <CountTile
              key={col.id}
              label={col.label}
              dotClassName={col.dot}
              value={missions.filter((m) => columnForMission(m.status) === col.id).length}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] w-[min(92vw,48rem)] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
              >
                <Sparkles className="size-5" />
              </span>
              <div className="grid gap-0.5">
                <DialogTitle>Create Mission</DialogTitle>
                <DialogDescription className="text-sm">
                  Turn an idea into an automated content workflow for your agent.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

        {agents === undefined || manifestsLoading ? (
          <p className="text-sm text-muted-foreground">Loading agents…</p>
        ) : activeAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {runningAgents.length === 0
              ? "No active agents. Activate an agent first."
              : "No active agent supports Missions: the active agents only run Jobs."}
          </p>
        ) : (
          <form onSubmit={(e) => { void handleSubmit(e); }} className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-muted-foreground">
                Agent
              </span>
              <NativeSelect
                value={effectiveTemplateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {activeAgents.map((a) => (
                  <option key={a.templateId} value={a.templateId}>
                    {manifests.find((m) => m.id === a.templateId)?.name ?? a.templateId}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-muted-foreground">
                Type
              </span>
              {allTypesHidden ? (
                <p className="m-0 text-sm text-muted-foreground">
                  Every Mission type of this agent is hidden. Unhide one in the agent&apos;s settings.
                </p>
              ) : missionTypes.length > 0 ? (
                <NativeSelect
                  value={type}
                  onChange={(e) => {
                    const next = e.target.value;
                    setType(next);
                    setRawPayloadMode(false);
                    // Pre-fill the payload with the selected type's default.
                    const option = missionTypes.find((t) => t.type === next);
                    if (option) setPayloadText(option.payload);
                  }}
                >
                  {missionTypes.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  type="text"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="e.g. seo.audit"
                  required
                />
              )}
            </label>
            </div>

            <div className="grid items-center gap-4 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-muted-foreground">
                Name{" "}
                <span className="font-normal">(optional)</span>
              </span>
              <Input
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
              {autoPublishAllowed && (
                <AutoPublishToggle checked={autoPublish} onChange={setAutoPublish} />
              )}
            </div>

            <div className="grid gap-3">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-expanded={payloadOpen}
                onClick={() => setPayloadOpen(!payloadOpen)}
                className="-ml-3 w-fit"
              >
                <ChevronDown className={cn("transition-transform", !payloadOpen && "-rotate-90")} />
                Payload (optional)
              </Button>
              {/* Kept mounted (hidden) so the edited payload survives a collapse. */}
              <div hidden={!payloadOpen}>
                <MissionPayloadEditor
                  fields={missionTypes.find((t) => t.type === type)?.fields}
                  payloadText={payloadText}
                  onChange={setPayloadText}
                  rawMode={rawPayloadMode}
                  onRawModeChange={setRawPayloadMode}
                />
              </div>
            </div>

            {error ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              size="lg"
              type="submit"
              loading={submitting}
              disabled={allTypesHidden}
              className="w-fit justify-self-end"
            >
              <Sparkles />
              {submitting ? "Creating…" : "Create Mission"}
            </Button>
          </form>
        )}
        </DialogContent>
      </Dialog>

      <section className="grid gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField value={query} onChange={setQuery} label="Search missions" placeholder="Search missions…" />
            <NativeSelect
              aria-label="Sort missions"
              value={sort}
              onChange={(e) => setSort(e.target.value === "oldest" ? "oldest" : "newest")}
              className="h-11 sm:w-44"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </NativeSelect>
          </div>
        </div>
        {missions === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <MissionKanbanBoard
            missions={missions}
            projectId={instanceId}
            doneMissions={doneMissions}
            doneStatus={doneStatus}
            onLoadMoreDone={() => loadMoreDone(DONE_PAGE_SIZE)}
            query={query}
            sort={sort}
          />
        )}
      </section>
    </div>
  );
}
