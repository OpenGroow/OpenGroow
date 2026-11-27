"use client";

import { use, useEffect, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AutoPublishToggle, supportsAutoPublish } from "./auto-publish-toggle";
import { COLUMNS, columnForMission, MissionKanbanBoard } from "./mission-kanban-board";
import { MissionPayloadEditor } from "./mission-payload-editor";
import { PublishChannelPicker } from "./publish-channel-picker";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import {
  missionTypesForManifest,
  validateMissionPayload,
  visibleMissionTypes,
} from "@/src/utils/mission-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/opengroow/page-header";
import { NoProviderNotice } from "@/src/components/no-provider-notice";
import { OutdatedTemplateNotice, isTemplateOutdated } from "@/src/components/outdated-template-notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CountTile } from "@/components/opengroow/count-tile";
import { SearchField } from "@/components/opengroow/filter-bar";
import { ListChecks, Plus, Sparkles, Trash2 } from "lucide-react";

type Props = {
  params: Promise<{ instanceId: string }>;
};

const DONE_PAGE_SIZE = 5;

// Payload keys the PublishChannelPicker edits: never shown in the extra-options JSON.
const PUBLISH_PICKER_KEYS = ["publishTargets", "publishAt"];

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
  const deleteMission = useMutation(api.missions.deleteMission);

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
  const [recipeId, setRecipeId] = useState<Id<"productionRecipes"> | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const effectiveTemplateId = templateId || activeAgents[0]?.templateId || "";
  const effectiveManifest = manifests.find((m) => m.id === effectiveTemplateId);
  // An outdated Template starts nothing new (ADR-091): the form says why and cannot be submitted.
  const templateOutdated = isTemplateOutdated(effectiveManifest);
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
  const payloadFields = missionTypes.find((t) => t.type === type)?.fields;
  // A creative Mission type requires a Production Recipe (ADR-091): the recipes written for this Template and
  // Mission type are listed with the Default preselected, and there is no empty choice. A choice that no longer
  // belongs to the offered list (the type changed, the recipe was deleted) falls back to the Default.
  const isCreative = effectiveManifest?.missionTypes?.find((t) => t.type === type.trim())?.kind === "creative";
  const offeredRecipes = useQuery(
    api.production_recipes.listForMissionType,
    createOpen && isCreative && effectiveTemplateId && type.trim()
      ? { instanceId, templateId: effectiveTemplateId, missionType: type.trim() }
      : "skip",
  );
  const chosenRecipeId: Id<"productionRecipes"> | "" = !isCreative
    ? ""
    : offeredRecipes?.some((r) => r._id === recipeId)
      ? recipeId
      : (offeredRecipes?.find((r) => r.isDefault) ?? offeredRecipes?.[0])?._id ?? "";
  const recipeMissing = isCreative && chosenRecipeId === "";
  const autoPublishAllowed = supportsAutoPublish(manifests, effectiveTemplateId, type.trim());
  // A Mission type that declares `publish` groups channels, Auto-publish and the
  // date in one "Publish" card; others keep the standalone toggle.
  const publishDecl = effectiveManifest?.missionTypes?.find((t) => t.type === type.trim())?.publish;
  const declaresPublish = publishDecl !== undefined;

  useEffect(() => {
    // When the agent changes, default to its first known mission type (and its
    // payload). Unknown templates have no preset, so the type falls back to a
    // free-text input with an empty payload.
    const [firstType] = missionTypes;
    setType(firstType?.type ?? "");
    setRecipeId("");
    setPayloadText(firstType?.payload ?? "");
    // A new template may not support autoPublish for its default mission
    // type — reset rather than carry a stale toggle across templates.
    setAutoPublish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTemplateId, hiddenKey, declaredKey]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggleSelected(missionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(missionId)) next.add(missionId);
      return next;
    });
  }

  // One `deleteMission` per Mission: each is checked on the server, so one refused
  // (a Run went live since) does not stop the others. Those that failed stay selected.
  async function handleDeleteSelected() {
    const ids = [...selected];
    if (!window.confirm(`Permanently delete ${ids.length} mission${ids.length === 1 ? "" : "s"} and all their runs?`)) return;
    setDeleting(true);
    const results = await Promise.allSettled(ids.map((id) => deleteMission({ missionId: id as Id<"missions"> })));
    setDeleting(false);
    const failed = ids.filter((_, i) => results[i]?.status === "rejected");
    setSelected(new Set(failed));
    if (failed.length === 0) setSelecting(false);
    else window.alert(`${failed.length} of ${ids.length} missions could not be deleted (a run may be in flight).`);
  }

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
    const payloadError = validateMissionPayload({
      missionTypes: declaredMissionTypes,
      type: type.trim(),
      payload,
    });
    if (payloadError) {
      setError(payloadError);
      return;
    }

    if (recipeMissing) {
      setError("This Mission type needs a Production Recipe: there is none to choose yet.");
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
        // The recipe is frozen on the Mission at its latest version (ADR-083).
        ...(chosenRecipeId ? { recipe: { recipeId: chosenRecipeId } } : {}),
      });
      setCreateOpen(false);
      setName("");
      setRecipeId("");
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
        description="Tasks you give your agents, from request to review and publication."
        action={
          <Button variant="glow" size="lg" type="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            Create Mission
          </Button>
        }
      />

      <NoProviderNotice projectId={instanceId} />

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
            {templateOutdated ? <OutdatedTemplateNotice names={[effectiveManifest?.name ?? effectiveTemplateId]} /> : null}
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
                    setRecipeId("");
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
              {autoPublishAllowed && !declaresPublish && (
                <AutoPublishToggle checked={autoPublish} onChange={setAutoPublish} />
              )}
            </div>

            {declaresPublish ? (
              <PublishChannelPicker
                instanceId={instanceId}
                payloadText={payloadText}
                kind={publishDecl?.kind}
                platforms={publishDecl?.platforms}
                onChange={setPayloadText}
                autoPublish={autoPublishAllowed ? { checked: autoPublish, onChange: setAutoPublish } : undefined}
              />
            ) : null}

            <MissionPayloadEditor
              fields={payloadFields}
              reservedKeys={declaresPublish ? PUBLISH_PICKER_KEYS : undefined}
              payloadText={payloadText}
              onChange={setPayloadText}
              rawMode={rawPayloadMode}
              onRawModeChange={setRawPayloadMode}
            />

            {isCreative && offeredRecipes && offeredRecipes.length > 0 ? (
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-muted-foreground">Production Recipe</span>
                <NativeSelect value={chosenRecipeId} onChange={(e) => setRecipeId(e.target.value as Id<"productionRecipes">)}>
                  {offeredRecipes.map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.name}
                      {r.isDefault ? " (Default)" : ""} (v{r.latestVersion})
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
            {isCreative && offeredRecipes && offeredRecipes.length === 0 ? (
              <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                This Mission type needs a Production Recipe and none is available. Update the Template or create a recipe first.
              </p>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              size="lg"
              type="submit"
              loading={submitting}
              disabled={allTypesHidden || templateOutdated || recipeMissing}
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
            {selecting ? (
              <>
                <span className="text-sm text-muted-foreground" aria-live="polite">
                  {selected.size} selected
                </span>
                <Button
                  variant="destructive"
                  type="button"
                  loading={deleting}
                  disabled={selected.size === 0}
                  onClick={() => { void handleDeleteSelected(); }}
                >
                  <Trash2 />
                  Delete{selected.size > 0 ? ` (${selected.size})` : ""}
                </Button>
                <Button variant="outline" type="button" disabled={deleting} onClick={stopSelecting}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" type="button" onClick={() => setSelecting(true)}>
                <ListChecks />
                Select
              </Button>
            )}
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
            selection={selecting ? { selected, onToggle: toggleSelected } : undefined}
          />
        )}
      </section>
    </div>
  );
}
