"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MissionPayloadEditor } from "./mission-payload-editor";
import {
  AUTO_PUBLISH_SCHEDULE_HINT,
  AutoPublishToggle,
  supportsAutoPublish,
} from "./auto-publish-toggle";
import { useProjectManifests } from "@/src/hooks/use-project-manifests";
import {
  missionTypesForManifest,
  validateMissionPayloadUnlessRaw,
  visibleMissionTypes,
} from "@/src/utils/mission-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/opengroow/page-header";
import { Card } from "@/components/ui/card";

type Props = {
  params: Promise<{ instanceId: string }>;
};

type CreateResult = { scheduleId: Id<"schedules">; nextRunAt: number };

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Human-readable cadence, e.g. "Daily at 09:00", "Weekly on Monday at 09:00",
 * "Monthly on day 15 at 09:00". */
export function formatCadence(schedule: {
  unit: string;
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
}): string {
  const at = `${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
  if (schedule.unit === "weekly") {
    return `Weekly on ${WEEKDAYS[schedule.dayOfWeek ?? 0]} at ${at}`;
  }
  if (schedule.unit === "monthly") {
    return `Monthly on day ${schedule.dayOfMonth ?? 1} at ${at}`;
  }
  return `Daily at ${at}`;
}

export function InstanceSchedulesPage({ params }: Props) {
  const { instanceId } = use(params);
  return <InstanceSchedulesContent instanceId={decodeURIComponent(instanceId)} />;
}

export function InstanceSchedulesContent({ instanceId }: { instanceId: string }) {
  const { manifests, loading: manifestsLoading } = useProjectManifests(instanceId);
  const agents = useQuery(api.project_agents.listByInstance, { instanceId });
  const schedules = useQuery(api.schedules.listByInstance, { instanceId });
  const createSchedule = useMutation(api.schedules.create);
  const pauseSchedule = useMutation(api.schedules.pause);
  const resumeSchedule = useMutation(api.schedules.resume);
  const removeSchedule = useMutation(api.schedules.remove);
  const updateSchedulePayload = useMutation(api.schedules.updatePayload);

  const activeAgents = agents?.filter((a) => a.status === "active") ?? [];

  const [expandedScheduleId, setExpandedScheduleId] = useState<Id<"schedules"> | null>(null);
  const [payloadDrafts, setPayloadDrafts] = useState<Record<string, string>>({});
  const [payloadErrors, setPayloadErrors] = useState<Record<string, string>>({});

  const [templateId, setTemplateId] = useState("");
  const [type, setType] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const [rawPayloadMode, setRawPayloadMode] = useState(false);
  const [unit, setUnit] = useState<"daily" | "weekly" | "monthly">("daily");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
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
  const autoPublishAllowed = supportsAutoPublish(manifests, effectiveTemplateId, type);

  useEffect(() => {
    const [firstType] = missionTypes;
    if (firstType) {
      setType(firstType.type);
      setPayloadText(firstType.payload);
    } else {
      setType("");
      setPayloadText("");
    }
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

    if (!effectiveTemplateId) {
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

    // The browser's timezone is captured at submission — never typed by the user.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const frequency =
      unit === "weekly"
        ? { unit, dayOfWeek, hour, minute }
        : unit === "monthly"
          ? { unit, dayOfMonth, hour, minute }
          : { unit: "daily" as const, hour, minute };

    setSubmitting(true);
    try {
      const res = await createSchedule({
        instanceId,
        templateId: effectiveTemplateId,
        type: type.trim(),
        payload,
        frequency,
        timezone,
        ...(autoPublishAllowed && autoPublish ? { autoPublish: true } : {}),
      });
      setResult(res as CreateResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create schedule.");
    } finally {
      setSubmitting(false);
    }
  }

  async function savePayloadDraft(scheduleId: Id<"schedules">, draft: string) {
    let payload: unknown;
    try {
      payload = draft.trim() ? (JSON.parse(draft) as unknown) : {};
    } catch {
      setPayloadErrors((prev) => ({ ...prev, [scheduleId]: "Payload must be valid JSON." }));
      return;
    }
    setPayloadErrors((prev) => {
      const next = { ...prev };
      delete next[scheduleId];
      return next;
    });
    try {
      await updateSchedulePayload({ scheduleId, payload });
    } catch (err) {
      setPayloadErrors((prev) => ({
        ...prev,
        [scheduleId]: err instanceof Error ? err.message : "Failed to save payload.",
      }));
    }
  }

  return (
    <div className="grid gap-8">
      <PageHeader title="Scheduler" description="Recurring jobs and their execution rules." />

      <Card className="grid gap-5 p-6">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          Create Schedule
        </h2>

        {agents === undefined || manifestsLoading ? (
          <p className="text-sm text-muted-foreground">Loading agents…</p>
        ) : activeAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active agents. Activate an agent first.
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
              <AutoPublishToggle
                checked={autoPublish}
                onChange={setAutoPublish}
                hint={AUTO_PUBLISH_SCHEDULE_HINT}
              />
            )}

            <MissionPayloadEditor
              fields={missionTypes.find((t) => t.type === type)?.fields}
              payloadText={payloadText}
              onChange={setPayloadText}
              rawMode={rawPayloadMode}
              onRawModeChange={setRawPayloadMode}
            />

            <fieldset className="grid gap-3 rounded-xl border border-border bg-card p-4">
              <legend className="px-1 text-sm font-semibold text-muted-foreground">
                Frequency
              </legend>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  Repeat
                </span>
                <NativeSelect
                  name="unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as "daily" | "weekly" | "monthly")}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </NativeSelect>
              </label>

              {unit === "weekly" ? (
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Day of week
                  </span>
                  <NativeSelect
                    name="dayOfWeek"
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  >
                    {WEEKDAYS.map((name, idx) => (
                      <option key={idx} value={idx}>
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}

              {unit === "monthly" ? (
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Day of month
                  </span>
                  <Input
                    name="dayOfMonth"
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(e) =>
                      setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value))))
                    }
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">
                    Months without this day fire on their last day.
                  </span>
                </label>
              ) : null}

              <div className="flex items-end gap-3">
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Hour
                  </span>
                  <Input
                    name="hour"
                    type="number"
                    min={0}
                    max={23}
                    value={hour}
                    onChange={(e) => setHour(Math.max(0, Math.min(23, Number(e.target.value))))}
                    className="w-20"
                  />
                </label>
                <span className="pb-3 text-base font-semibold text-muted-foreground">:</span>
                <label className="grid gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Minute
                  </span>
                  <Input
                    name="minute"
                    type="number"
                    min={0}
                    max={59}
                    value={minute}
                    onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
                    className="w-20"
                  />
                </label>
              </div>
            </fieldset>

            {error ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            {result ? (
              <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">
                <p className="m-0 font-semibold text-primary">Schedule created</p>
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  Next run {new Date(result.nextRunAt).toLocaleString()}
                </p>
              </div>
            ) : null}

            <Button
              size="lg"
              type="submit"
              disabled={submitting || allTypesHidden}
            >
              {submitting ? "Creating…" : "Create Schedule"}
            </Button>
          </form>
        )}
      </Card>

      <Card className="grid gap-5 p-6">
        <h2 className="m-0 text-lg font-semibold text-foreground">
          Schedules
        </h2>
        {schedules === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No schedules yet.</p>
        ) : (
          <ul className="grid gap-3">
            {schedules.map((schedule) => {
              const isExpanded = expandedScheduleId === schedule._id;
              return (
                <li
                  key={schedule._id}
                  className="rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    data-action="toggle-details"
                    aria-expanded={isExpanded}
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedScheduleId(null);
                      } else {
                        setExpandedScheduleId(schedule._id);
                        setPayloadDrafts((prev) => ({
                          ...prev,
                          [schedule._id]: JSON.stringify(schedule.payload, null, 2),
                        }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        if (isExpanded) {
                          setExpandedScheduleId(null);
                        } else {
                          setExpandedScheduleId(schedule._id);
                          setPayloadDrafts((prev) => ({
                            ...prev,
                            [schedule._id]: JSON.stringify(schedule.payload, null, 2),
                          }));
                        }
                      }
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 text-left"
                  >
                    <div className="grid gap-0.5">
                      <span className="text-sm font-semibold text-foreground">
                        {schedule.type}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatCadence(schedule)}
                      </span>
                      {schedule.lastRunAt !== undefined ? (
                        <span className="text-xs text-muted-foreground">
                          Last run {new Date(schedule.lastRunAt).toLocaleString()}
                        </span>
                      ) : null}
                      {schedule.lastMissionId ? (
                        <a
                          data-testid="last-mission-link"
                          href={`/projects/${encodeURIComponent(instanceId)}/missions/${schedule.lastMissionId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          Last mission
                        </a>
                      ) : null}
                      {schedule.lastError ? (
                        <span className="text-xs text-destructive">
                          {schedule.lastError}
                        </span>
                      ) : null}
                    </div>
                    <div className="grid justify-items-end gap-0.5 text-right">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Next run
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {schedule.status === "paused" ? "Paused" : new Date(schedule.nextRunAt).toLocaleString()}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`mt-1 text-xs text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      >
                        ▾
                      </span>
                    </div>
                  </div>

                  {isExpanded ? (
                    <div className="mt-3 grid gap-2 rounded-xl border border-border bg-background p-3 text-xs text-foreground">
                      <div className="grid grid-cols-[6rem_1fr] gap-1">
                        <span className="font-semibold text-muted-foreground">Agent</span>
                        <span className="break-all">{schedule.templateId}</span>
                        <span className="font-semibold text-muted-foreground">Type</span>
                        <span className="break-all">{schedule.type}</span>
                        <span className="font-semibold text-muted-foreground">Timezone</span>
                        <span>{schedule.timezone}</span>
                      </div>
                      <div className="grid gap-1">
                        <span className="font-semibold text-muted-foreground">Payload</span>
                        <Textarea
                          data-testid="schedule-payload-editor"
                          value={payloadDrafts[schedule._id] ?? JSON.stringify(schedule.payload, null, 2)}
                          onChange={(e) =>
                            setPayloadDrafts((prev) => ({ ...prev, [schedule._id]: e.target.value }))
                          }
                          onBlur={(e) => { void savePayloadDraft(schedule._id, e.target.value); }}
                          onClick={(e) => e.stopPropagation()}
                          rows={6}
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          className="font-mono"
                        />
                        {payloadErrors[schedule._id] ? (
                          <span className="text-xs text-destructive">{payloadErrors[schedule._id]}</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2 flex justify-end gap-2">
                    {schedule.status === "active" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        data-action="pause"
                        onClick={() => { void pauseSchedule({ scheduleId: schedule._id }); }}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        data-action="resume"
                        onClick={() => { void resumeSchedule({ scheduleId: schedule._id }); }}
                      >
                        Resume
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      data-action="delete"
                      onClick={() => { void removeSchedule({ scheduleId: schedule._id }); }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
