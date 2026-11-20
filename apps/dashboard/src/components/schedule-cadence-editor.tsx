"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type Cadence = {
  unit: "daily" | "weekly" | "monthly";
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour: number;
  minute: number;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(value) || 0));

/** Edits the cadence of an existing Schedule (the timezone stays the one it was created with). */
export function ScheduleCadenceEditor({ schedule, onSave }: { schedule: Cadence; onSave: (cadence: Cadence) => Promise<unknown> }) {
  const [unit, setUnit] = useState(schedule.unit);
  const [dayOfWeek, setDayOfWeek] = useState(schedule.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(schedule.dayOfMonth ?? 1);
  const [hour, setHour] = useState(schedule.hour);
  const [minute, setMinute] = useState(schedule.minute);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const cadence: Cadence =
      unit === "weekly" ? { unit, dayOfWeek, hour, minute } : unit === "monthly" ? { unit, dayOfMonth, hour, minute } : { unit, hour, minute };
    setSaving(true);
    setError(null);
    try {
      await onSave(cadence);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change the cadence.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Label className="font-semibold text-muted-foreground">Cadence</Label>
      <div className="flex flex-wrap items-end gap-3">
        <NativeSelect name="unit" aria-label="Repeat" value={unit} onChange={(e) => setUnit(e.target.value as Cadence["unit"])}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </NativeSelect>
        {unit === "weekly" ? (
          <NativeSelect name="dayOfWeek" aria-label="Day of week" value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {DAYS.map((name, idx) => (
              <option key={name} value={idx}>{name}</option>
            ))}
          </NativeSelect>
        ) : null}
        {unit === "monthly" ? (
          <Input name="dayOfMonth" aria-label="Day of month" type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(clamp(Number(e.target.value), 1, 31))} className="w-20" />
        ) : null}
        <Input name="hour" aria-label="Hour" type="number" min={0} max={23} value={hour} onChange={(e) => setHour(clamp(Number(e.target.value), 0, 23))} className="w-20" />
        <span className="pb-2 font-semibold text-muted-foreground">:</span>
        <Input name="minute" aria-label="Minute" type="number" min={0} max={59} value={minute} onChange={(e) => setMinute(clamp(Number(e.target.value), 0, 59))} className="w-20" />
        <Button variant="outline" className="rounded-full" data-action="save-cadence" loading={saving} onClick={() => { void save(); }}>
          Save cadence
        </Button>
      </div>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
