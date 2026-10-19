"use client";

import { use, useEffect, useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AutoPublishToggle, supportsAutoPublish } from "./auto-publish-toggle";
import { MissionKanbanBoard } from "./mission-kanban-board";
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
import { Card } from "@/components/ui/card";

type Props = {
  params: Promise<{ instanceId: string }>;
};

type CreateResult = { missionId: Id<"missions">; runId: Id<"runs"> };

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
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

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
      const res = await createMission({
        instanceId,
        templateId: selectedTemplateId,
        type: type.trim(),
        payload,
        name: name.trim(),
        // Only sent when opted in — an unchecked box leaves the field absent
        // rather than persisting an explicit `false`.
        ...(autoPublishAllowed && autoPublish ? { autoPublish: true } : {}),
      });
      setResult(res as CreateResult);
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
      <PageHeader title="Missions" description="Goals, outcomes, review and progress." />

      <Card className="grid gap-5 p-6">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          Create Mission
        </h2>

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
                Name
              </span>
              <Input
                type="text"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Article about running shoes (auto-derived if left blank)"
              />
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

            {autoPublishAllowed && (
              <AutoPublishToggle checked={autoPublish} onChange={setAutoPublish} />
            )}

            <MissionPayloadEditor
              fields={missionTypes.find((t) => t.type === type)?.fields}
              payloadText={payloadText}
              onChange={setPayloadText}
              rawMode={rawPayloadMode}
              onRawModeChange={setRawPayloadMode}
            />

            {error ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {result ? (
              <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
                <p className="m-0 font-semibold text-primary">Mission created</p>
                <p className="m-0 mt-1 font-mono text-sm text-muted-foreground">
                  missionId: {result.missionId}
                </p>
                <p className="m-0 font-mono text-sm text-muted-foreground">
                  runId: {result.runId}
                </p>
              </div>
            ) : null}

            <Button
              size="lg"
              type="submit"
              disabled={submitting || allTypesHidden}
            >
              {submitting ? "Creating…" : "Create Mission"}
            </Button>
          </form>
        )}
      </Card>

      <section className="grid gap-5">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          Missions
        </h2>
        {missions === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <MissionKanbanBoard
            missions={missions}
            projectId={instanceId}
            doneMissions={doneMissions}
            doneStatus={doneStatus}
            onLoadMoreDone={() => loadMoreDone(DONE_PAGE_SIZE)}
          />
        )}
      </section>
    </div>
  );
}
