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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { StatTile } from "@/components/opengroow/stat-tile";
import { StatusBadge } from "@/components/opengroow/status-badge";
import { FilterChips, SearchField } from "@/components/opengroow/filter-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  CalendarDays,
  CircleCheck,
  ChevronDown,
  Ellipsis,
  FileJson,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";

type Props = {
  params: Promise<{ instanceId: string }>;
};

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

/** Compact cadence for a row inside a family, e.g. "09:00", "Sunday 13:21". */
export function formatSlot(schedule: Parameters<typeof formatCadence>[0]): string {
  const at = `${pad2(schedule.hour)}:${pad2(schedule.minute)}`;
  if (schedule.unit === "weekly") return `${WEEKDAYS[schedule.dayOfWeek ?? 0]} ${at}`;
  if (schedule.unit === "monthly") return `Day ${schedule.dayOfMonth ?? 1} ${at}`;
  return at;
}

// Family tiles alternate colour only: what a family does is not known in
// advance, so no glyph. The order follows the list, not the Mission type.
const FAMILY_TONES = [
  "bg-tone-green-soft",
  "bg-tone-violet-soft",
  "bg-tone-cyan-soft",
  "bg-tone-blue-soft",
  "bg-tone-slate-soft",
];

const UNIT_LABELS: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

const UNIT_ORDER: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 };

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

  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [query, setQuery] = useState("");
  // Family key -> open/closed; absent = default (only the first family is open).
  const [openFamilies, setOpenFamilies] = useState<Record<string, boolean>>({});
  const [expandedScheduleId, setExpandedScheduleId] = useState<Id<"schedules"> | null>(null);
  const [payloadDrafts, setPayloadDrafts] = useState<Record<string, string>>({});
  const [payloadErrors, setPayloadErrors] = useState<Record<string, string>>({});

  const [templateId, setTemplateId] = useState("");
  const [type, setType] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const [rawPayloadMode, setRawPayloadMode] = useState(false);
  // null = follow the default: open when the Mission type declares payload
  // fields (the form must be visible), collapsed for a plain JSON payload.
  const [payloadOpenOverride, setPayloadOpenOverride] = useState<boolean | null>(null);
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
  const payloadOpen =
    payloadOpenOverride ?? (missionTypes.find((t) => t.type === type)?.fields?.length ?? 0) > 0;
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
  const [createOpen, setCreateOpen] = useState(false);
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
      await createSchedule({
        instanceId,
        templateId: effectiveTemplateId,
        type: type.trim(),
        payload,
        frequency,
        timezone,
        ...(autoPublishAllowed && autoPublish ? { autoPublish: true } : {}),
      });
      setCreateOpen(false);
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

  const needle = query.trim().toLowerCase();
  const visibleSchedules = (schedules ?? []).filter((schedule) => {
    if (statusFilter !== "all" && schedule.status !== statusFilter) return false;
    if (!needle) return true;
    const agentName = manifests.find((m) => m.id === schedule.templateId)?.name ?? schedule.templateId;
    return `${schedule.type} ${agentName}`.toLowerCase().includes(needle);
  });

  // A family groups the schedules of one Agent running the same Mission type.
  const families: { key: string; templateId: string; type: string; items: typeof visibleSchedules }[] = [];
  for (const schedule of visibleSchedules) {
    const key = `${schedule.templateId}\u0000${schedule.type}`;
    let family = families.find((f) => f.key === key);
    if (!family) {
      family = { key, templateId: schedule.templateId, type: schedule.type, items: [] };
      families.push(family);
    }
    family.items.push(schedule);
  }
  for (const family of families) {
    family.items.sort(
      (a, b) =>
        (UNIT_ORDER[a.unit] ?? 0) - (UNIT_ORDER[b.unit] ?? 0) ||
        (a.dayOfWeek ?? a.dayOfMonth ?? 0) - (b.dayOfWeek ?? b.dayOfMonth ?? 0) ||
        a.hour - b.hour ||
        a.minute - b.minute,
    );
  }

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Scheduler"
        description="Recurring jobs and their execution rules."
        action={
          <Button variant="glow" size="lg" type="button" onClick={() => setCreateOpen(true)}>
            <Plus />
            Create Schedule
          </Button>
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] w-[min(92vw,48rem)] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
              >
                <CalendarClock className="size-5" />
              </span>
              <div className="grid gap-0.5">
                <DialogTitle>Create Schedule</DialogTitle>
                <DialogDescription className="text-sm">
                  Run a mission automatically on a recurring cadence.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

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

            <div className="grid gap-3">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-expanded={payloadOpen}
                onClick={() => setPayloadOpenOverride(!payloadOpen)}
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

            <Button
              size="lg"
              type="submit"
              loading={submitting}
              disabled={allTypesHidden}
              className="w-fit justify-self-end"
            >
              <CalendarClock />
              {submitting ? "Creating…" : "Create Schedule"}
            </Button>
          </form>
        )}
        </DialogContent>
      </Dialog>

      {schedules === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No schedules yet.</p>
      ) : (
        <>
          <section aria-label="Schedule counts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile icon={CalendarClock} label="Total schedules" value={schedules.length} tone="visual" />
            <StatTile
              icon={CircleCheck}
              label="Active"
              value={schedules.filter((x) => x.status === "active").length}
              tone="engagement"
            />
            <StatTile
              icon={Pause}
              label="Paused"
              value={schedules.filter((x) => x.status === "paused").length}
            />
          </section>

        <section className="grid gap-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterChips
              label="Filter schedules by status"
              value={statusFilter}
              onChange={(id) => setStatusFilter(id as "all" | "active" | "paused")}
              options={[
                { id: "all", label: "All", count: schedules.length },
                { id: "active", label: "Active", count: schedules.filter((x) => x.status === "active").length },
                { id: "paused", label: "Paused", count: schedules.filter((x) => x.status === "paused").length },
              ]}
            />
            <SearchField
              value={query}
              onChange={setQuery}
              label="Search schedules"
              placeholder="Search schedules…"
            />
          </div>

          {families.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schedules match.</p>
          ) : null}
          <ul className="grid gap-4">
            {families.map((family, index) => {
              const open = openFamilies[family.key] ?? index === 0;
              const familyTone = FAMILY_TONES[index % FAMILY_TONES.length];
              const manifest = manifests.find((m) => m.id === family.templateId);
              const agentName = manifest?.name ?? family.templateId;
              const typeLabel =
                (manifest
                  ? missionTypesForManifest(manifest).find((t) => t.type === family.type)?.label
                  : undefined) ?? family.type;
              const units = new Set(family.items.map((x) => x.unit));
              const summary =
                family.items.length === 1
                  ? `${UNIT_LABELS[family.items[0].unit] ?? "Daily"} · ${formatSlot(family.items[0])}`
                  : units.size === 1
                    ? `${UNIT_LABELS[family.items[0].unit] ?? "Daily"} · ${family.items.length} scheduled runs`
                    : `${family.items.length} scheduled runs`;
              return (
                <li key={family.key}>
                  <Card className="gap-0 p-0" data-family={family.type}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenFamilies((prev) => ({ ...prev, [family.key]: !open }))}
                      className="flex w-full items-center gap-4 rounded-xl px-5 py-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span
                        aria-hidden="true"
                        className={cn("size-11 shrink-0 rounded-xl", familyTone)}
                      />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex items-center gap-2.5">
                          <span className="text-lg font-semibold break-all text-foreground">{typeLabel}</span>
                          <span className="rounded-md bg-muted px-1.5 text-sm text-muted-foreground tabular-nums">
                            {family.items.length}
                          </span>
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {agentName} · {summary}
                        </span>
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                      />
                    </button>

                    {/* Kept mounted (hidden) so row state survives a collapse. */}
                    <div hidden={!open} className="border-t border-border">
                      <ul className="grid">
                        {family.items.map((schedule) => {
                          const isExpanded = expandedScheduleId === schedule._id;
                          const paused = schedule.status === "paused";
                          return (
                            <li key={schedule._id} className="border-b border-border/60 last:border-b-0">
                              <div className="flex items-center gap-6 px-5 py-3">
                                <span className="inline-flex w-48 items-center gap-3 text-base text-foreground tabular-nums">
                                  <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                                  {formatSlot(schedule)}
                                </span>

                                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                                  <span
                                    aria-hidden="true"
                                    className={cn("size-1.5 rounded-full", paused ? "bg-status-paused" : "bg-tone-green")}
                                  />
                                  {paused ? "Paused" : "Active"}
                                </span>

                                <div className="ml-auto flex items-center gap-2">
                                  {paused ? (
                                    <Button
                                      variant="outline"
                                      className="rounded-full"
                                      data-action="resume"
                                      onClick={() => { void resumeSchedule({ scheduleId: schedule._id }); }}
                                    >
                                      <Play />
                                      Resume
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      className="rounded-full"
                                      data-action="pause"
                                      onClick={() => { void pauseSchedule({ scheduleId: schedule._id }); }}
                                    >
                                      <Pause />
                                      Pause
                                    </Button>
                                  )}
                                  <DropdownMenu>
                                    <DropdownMenuTrigger
                                      render={<Button variant="outline" size="icon" aria-label="More actions" data-action="more" />}
                                    >
                                      <Ellipsis />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                      <DropdownMenuItem
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
                                      >
                                        <FileJson />
                                        {isExpanded ? "Hide payload" : "Edit payload"}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        className="text-status-error"
                                        onClick={() => { void removeSchedule({ scheduleId: schedule._id }); }}
                                      >
                                        <Trash2 />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>

                              {isExpanded ? (
                                <div className="px-5 pb-5">
                                  <div className="grid gap-2 rounded-xl border border-border bg-background p-4 text-xs text-foreground">
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
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
        </>
      )}
    </div>
  );
}
