import * as React from "react"

import { cn } from "@/lib/utils"

// Small dependency-free SVG charts for the Project Overview. Colours come from
// the `text-*` utility on the series (`stroke-current` / `fill-current`), so
// they stay on the semantic tokens of globals.css.

type Point = { x: number; y: number }

/** Monotone cubic path through `points` (no overshoot below the data). */
function smoothPath(points: Point[]): string {
  if (points.length === 0) return ""
  if (points.length === 1) return `M${points[0].x},${points[0].y}`
  const n = points.length
  const slopes: number[] = []
  const tangents: number[] = []
  for (let i = 0; i < n - 1; i++) {
    slopes.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x || 1))
  }
  tangents.push(slopes[0])
  for (let i = 1; i < n - 1; i++) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2)
  }
  tangents.push(slopes[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = tangents[i] / slopes[i]
    const b = tangents[i + 1] / slopes[i]
    const norm = Math.hypot(a, b)
    if (norm > 3) {
      tangents[i] = (3 * a * slopes[i]) / norm
      tangents[i + 1] = (3 * b * slopes[i]) / norm
    }
  }
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (points[i + 1].x - points[i].x) / 3
    d += ` C${points[i].x + dx},${points[i].y + tangents[i] * dx} ${points[i + 1].x - dx},${points[i + 1].y - tangents[i + 1] * dx} ${points[i + 1].x},${points[i + 1].y}`
  }
  return d
}

const WIDTH = 100
const HEIGHT = 100

function project(values: number[], max: number): Point[] {
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0
  return values.map((value, i) => ({ x: i * step, y: HEIGHT - (value / (max || 1)) * HEIGHT }))
}

/** A line with a faded area under it, for a tile; `className` sets the colour. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const gradient = React.useId()
  const max = Math.max(...values, 0)
  if (values.length < 2 || max === 0) {
    return <div aria-hidden="true" className={cn("h-12 border-b border-border", className)} />
  }
  const line = smoothPath(project(values, max))
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("h-12 w-full overflow-visible", className)}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`} fill={`url(#${gradient})`} stroke="none" />
      <path d={line} fill="none" className="stroke-current" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

type AreaSeries = { id: string; label: string; values: number[]; className: string }

/** Rounds `max` up to a tick step of 1, 2, 5 x 10^n so the grid reads cleanly. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 2, 4] }
  const rough = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude
  const top = Math.ceil(max / step) * step
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
}

/**
 * Overlapping smooth areas over a shared time axis. `labels` has one entry per
 * value; about five of them are shown under the plot.
 */
function AreaChart({
  series,
  labels,
  className,
}: {
  series: AreaSeries[]
  labels: string[]
  className?: string
}) {
  const baseId = React.useId()
  const max = Math.max(...series.flatMap((s) => s.values), 0)
  const { top, ticks } = niceScale(max)
  const shownLabels = labels.length <= 5 ? labels.map((_, i) => i) : [0, 1, 2, 3, 4].map((i) => Math.round((i * (labels.length - 1)) / 4))
  return (
    <div className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-2", className)}>
      <div className="relative text-sm text-muted-foreground tabular-nums" aria-hidden="true">
        {[...ticks].reverse().map((tick) => (
          <span
            key={tick}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${100 - (tick / top) * 100}%` }}
          >
            {tick}
          </span>
        ))}
      </div>
      <svg
        role="img"
        aria-label={`Missions per day: ${series.map((s) => s.label).join(", ")}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-56 w-full overflow-visible"
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.id} id={`${baseId}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((tick) => {
          const y = HEIGHT - (tick / top) * HEIGHT
          return (
            <line
              key={tick}
              x1="0"
              x2={WIDTH}
              y1={y}
              y2={y}
              className="stroke-border"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {series.map((s) => {
          const line = smoothPath(project(s.values, top))
          return (
            <g key={s.id} className={s.className}>
              <path d={`${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`} fill={`url(#${baseId}-${s.id})`} stroke="none" />
              <path d={line} fill="none" className="stroke-current" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
      <span />
      <div className="flex justify-between text-sm text-muted-foreground tabular-nums" aria-hidden="true">
        {shownLabels.map((i) => (
          <span key={i}>{labels[i]}</span>
        ))}
      </div>
    </div>
  )
}

type DonutSlice = { id: string; label: string; value: number; className: string }

/** A ring split by `slices`; `children` sits in the middle. */
function DonutChart({
  slices,
  children,
  className,
}: {
  slices: DonutSlice[]
  children?: React.ReactNode
  className?: string
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className={cn("relative size-44 shrink-0", className)}>
      <svg role="img" aria-label="Missions by status" viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" className="stroke-muted" strokeWidth="11" />
        {total > 0
          ? slices
              .filter((s) => s.value > 0)
              .map((s) => {
                const length = (s.value / total) * circumference
                const circle = (
                  <circle
                    key={s.id}
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="none"
                    className={cn("stroke-current", s.className)}
                    strokeWidth="11"
                    strokeDasharray={`${Math.max(length - 1, 0)} ${circumference}`}
                    strokeDashoffset={-offset}
                  />
                )
                offset += length
                return circle
              })
          : null}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">{children}</div>
    </div>
  )
}

export { AreaChart, DonutChart, Sparkline, type AreaSeries, type DonutSlice }
