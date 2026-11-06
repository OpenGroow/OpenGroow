"use client";

import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** `Nov 6, 2026, 12:30 PM`, in the user's language. */
export function formatDateTime(ms: number): string {
  return formatter.format(ms);
}

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (ms: number) => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

/** The next full hour, the time offered when a day is picked before any time. */
function nextFullHour(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${pad(d.getHours())}:00`;
}

function combine(day: Date, time: string): number {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0).getTime();
}

/**
 * A future date and time as epoch ms (shadcn Popover + Calendar, and a time
 * field): replaces the browser's own datetime-local picker. `onChange(undefined)`
 * clears it ("publish immediately"). A moment that is not in the future is
 * refused with `onError("publishAt must be in the future")`.
 */
export function DateTimePicker({
  value,
  onChange,
  onError,
  disabled,
  placeholder = "Publish immediately",
}: {
  value: number | undefined;
  onChange: (ms: number | undefined) => void;
  onError?: (message: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState<string | null>(null);
  const day = value === undefined ? undefined : new Date(value);
  const shownTime = time ?? (value !== undefined ? timeOf(value) : nextFullHour());
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function apply(date: Date, atTime: string) {
    const ms = combine(date, atTime);
    if (ms <= Date.now()) {
      onError?.("publishAt must be in the future");
      return;
    }
    onError?.(null);
    onChange(ms);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            data-testid="publish-at"
            disabled={disabled}
            className="w-full max-w-xs justify-start gap-2 font-normal"
          />
        }
      >
        <CalendarIcon className="text-muted-foreground" />
        <span className={value === undefined ? "text-muted-foreground" : undefined}>
          {value === undefined ? placeholder : formatDateTime(value)}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-3 p-3">
        <Calendar
          mode="single"
          selected={day}
          onSelect={(picked) => {
            if (picked) apply(picked, shownTime);
          }}
          disabled={{ before: today }}
          defaultMonth={day}
        />
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Input
            type="time"
            aria-label="Time"
            data-testid="publish-at-time"
            value={shownTime}
            onChange={(e) => {
              setTime(e.target.value);
              if (day && e.target.value) apply(day, e.target.value);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={value === undefined}
            onClick={() => {
              setTime(null);
              onError?.(null);
              onChange(undefined);
            }}
          >
            <X /> Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
