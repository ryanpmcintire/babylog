"use client";

import { useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import { buildDailyBuckets, type DayBucket } from "@/lib/aggregates";

const RANGE_OPTIONS = [7, 14, 30];

export function Trends({ events }: { events: BabyEvent[] }) {
  const [days, setDays] = useState(7);

  const buckets = useMemo(
    () => buildDailyBuckets(events, days),
    [events, days],
  );

  if (events.length === 0) return null;

  const milk = buckets.map((b) => b.milkMl);
  const sleepHrs = buckets.map((b) => b.sleepMinutes / 60);
  const feeds = buckets.map((b) => b.feeds);
  const diapers = buckets.map((b) => b.diapers);
  const pumpMl = buckets.map((b) => b.pumpMl);

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">
          Daily totals
        </h2>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setDays(r)}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold border transition " +
                (days === r
                  ? "bg-accent text-white border-accent"
                  : "bg-surface text-muted border-accent-soft")
              }
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <DailyBars
        title="Milk in"
        unit="ml"
        values={milk}
        buckets={buckets}
        formatValue={(v) => (v ? `${Math.round(v)}` : "")}
      />
      <DailyBars
        title="Sleep"
        unit="hrs"
        values={sleepHrs}
        buckets={buckets}
        formatValue={(v) => (v >= 0.1 ? v.toFixed(1) : "")}
      />
      <DailyBars
        title="Feeds"
        unit="count"
        values={feeds}
        buckets={buckets}
        formatValue={(v) => (v ? `${v}` : "")}
      />
      <DailyBars
        title="Diapers"
        unit="count"
        values={diapers}
        buckets={buckets}
        formatValue={(v) => (v ? `${v}` : "")}
      />
      <DailyBars
        title="Pumped"
        unit="ml"
        values={pumpMl}
        buckets={buckets}
        formatValue={(v) => (v ? `${Math.round(v)}` : "")}
      />
    </div>
  );
}

function DailyBars({
  title,
  unit,
  values,
  buckets,
  formatValue,
}: {
  title: string;
  unit: string;
  values: number[];
  buckets: DayBucket[];
  formatValue: (v: number) => string;
}) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = total / values.length;

  return (
    <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted">
            {unit}/day
          </span>
        </div>
        <span className="text-[10px] text-muted">
          avg {unit === "count" ? avg.toFixed(1) : Math.round(avg)}
        </span>
      </div>

      <div
        className="grid gap-[2px] items-end"
        style={{
          gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))`,
        }}
      >
        {values.map((v, i) => {
          const pct = (v / max) * 100;
          const label = formatValue(v);
          const isLatest = i === values.length - 1;
          return (
            <div key={i} className="flex flex-col items-center">
              <span
                className={
                  "text-[10px] tabular-nums leading-tight h-4 " +
                  (isLatest ? "text-accent font-bold" : "text-muted")
                }
              >
                {label}
              </span>
              <div className="w-full h-[60px] flex items-end">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${Math.max(pct, v > 0 ? 4 : 0)}%`,
                    background: isLatest
                      ? "var(--color-accent)"
                      : "var(--color-sage-300)",
                    opacity: v === 0 ? 0.15 : 1,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="grid gap-[2px] mt-1"
        style={{
          gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))`,
        }}
      >
        {buckets.map((b, i) => (
          <span
            key={i}
            className={
              "text-[9px] text-center truncate " +
              (i === buckets.length - 1
                ? "text-foreground font-semibold"
                : "text-muted")
            }
          >
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
