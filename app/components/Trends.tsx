"use client";

import { useMemo } from "react";
import type { BabyEvent } from "@/lib/events";
import { buildDailyBuckets, type DayBucket } from "@/lib/aggregates";

export function Trends({
  events,
  days = 7,
}: {
  events: BabyEvent[];
  days?: number;
}) {
  const buckets = useMemo(
    () => buildDailyBuckets(events, days),
    [events, days],
  );

  if (events.length === 0) return null;

  const milk = buckets.map((b) => b.milkMl);
  const sleep = buckets.map((b) => b.sleepMinutes / 60);
  const feeds = buckets.map((b) => b.feeds);
  const diapers = buckets.map((b) => b.diapers);

  return (
    <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">
        Last {days} days
      </h2>
      <div className="grid grid-cols-2 gap-4">
        <Spark
          label="Milk"
          unit="ml/day"
          values={milk}
          buckets={buckets}
          formatValue={(v) => `${Math.round(v)} ml`}
        />
        <Spark
          label="Sleep"
          unit="hrs/day"
          values={sleep}
          buckets={buckets}
          formatValue={(v) => `${v.toFixed(1)}h`}
        />
        <Spark
          label="Feeds"
          unit="per day"
          values={feeds}
          buckets={buckets}
          formatValue={(v) => `${v}`}
        />
        <Spark
          label="Diapers"
          unit="per day"
          values={diapers}
          buckets={buckets}
          formatValue={(v) => `${v}`}
        />
      </div>
    </div>
  );
}

function Spark({
  label,
  unit,
  values,
  buckets,
  formatValue,
}: {
  label: string;
  unit: string;
  values: number[];
  buckets: DayBucket[];
  formatValue: (v: number) => string;
}) {
  const width = 160;
  const height = 60;
  const padX = 4;
  const padY = 6;
  const latest = values[values.length - 1] ?? 0;
  const max = Math.max(1, ...values);

  const points = values.map((v, i) => {
    const x =
      padX +
      (values.length === 1 ? 0 : (i / (values.length - 1)) * (width - padX * 2));
    const y = height - padY - (v / max) * (height - padY * 2);
    return { x, y, v, label: buckets[i]?.label ?? "" };
  });

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const area =
    points.length > 1
      ? `${path} L${points[points.length - 1]!.x.toFixed(1)} ${height - padY} L${points[0]!.x.toFixed(1)} ${height - padY} Z`
      : "";

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <span className="text-[10px] text-muted">{unit}</span>
      </div>
      <div className="text-lg font-bold tabular-nums text-accent">
        {formatValue(latest)}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-[60px] mt-1"
        aria-label={`${label} trend`}
      >
        {area && (
          <path d={area} fill="var(--color-accent)" opacity="0.12" />
        )}
        <path
          d={path}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={i === points.length - 1 ? 2.6 : 1.6}
            fill="var(--color-accent)"
          />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-muted mt-0.5 px-0.5">
        {buckets.map((b, i) => (
          <span key={i}>{b.label}</span>
        ))}
      </div>
    </div>
  );
}
