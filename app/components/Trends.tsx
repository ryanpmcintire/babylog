"use client";

import { useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import { buildDailyBuckets, type DayBucket } from "@/lib/aggregates";
import { LILY_BIRTHDATE } from "@/lib/age";
import { dailySleepNorm } from "@/lib/norms";

const RANGE_OPTIONS = [3, 7, 14, 30];

export function Trends({ events }: { events: BabyEvent[] }) {
  const [days, setDays] = useState(7);

  const buckets = useMemo(
    () => buildDailyBuckets(events, days, new Date(), { inferBufferMin: 10 }),
    [events, days],
  );

  if (events.length === 0) return null;

  const milk = buckets.map((b) => b.milkMl);
  const sleepHrs = buckets.map((b) => b.sleepMinutes / 60);
  const feeds = buckets.map((b) => b.feeds);
  const diapers = buckets.map((b) => b.diapers);
  const pumpMl = buckets.map((b) => b.pumpMl);

  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - LILY_BIRTHDATE.getTime()) / 86400000),
  );
  const sleepRef = dailySleepNorm(ageDays);

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
                "rounded-full px-3 py-1 text-xs font-semibold border transition-all duration-150 hover:shadow-sm active:scale-[0.95] " +
                (days === r
                  ? "bg-accent text-white border-accent"
                  : "bg-surface text-muted border-accent-soft hover:border-accent/60 hover:text-foreground")
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
        referenceBand={sleepRef}
        referenceLabel={`typical ${sleepRef.min}-${sleepRef.max}h`}
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
  referenceBand,
  referenceLabel,
}: {
  title: string;
  unit: string;
  values: number[];
  buckets: DayBucket[];
  formatValue: (v: number) => string;
  referenceBand?: { min: number; max: number };
  referenceLabel?: string;
}) {
  const max = Math.max(1, ...values, referenceBand ? referenceBand.max : 0);
  const active = values.filter((v) => v > 0);
  const avg =
    active.length > 0
      ? active.reduce((a, b) => a + b, 0) / active.length
      : 0;

  const bandBottomPct = referenceBand
    ? (referenceBand.min / max) * 100
    : 0;
  const bandTopPct = referenceBand
    ? (referenceBand.max / max) * 100
    : 0;

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

      <div className="relative">
        {referenceBand && (
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 pointer-events-none"
            style={{
              bottom: `${bandBottomPct}%`,
              height: `${bandTopPct - bandBottomPct}%`,
              background: "var(--color-sage-300)",
              opacity: 0.12,
              borderTop: "1px dashed var(--divider)",
              borderBottom: "1px dashed var(--divider)",
            }}
          />
        )}
      <div
        className="grid gap-[2px] items-end relative"
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
      </div>
      {referenceLabel && (
        <div className="text-[9px] text-muted text-right mt-0.5">
          {referenceLabel}
        </div>
      )}

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
