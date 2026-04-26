"use client";

import { useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import { FEVER_THRESHOLD_F, HIGH_FEVER_THRESHOLD_F } from "@/lib/events";
import { buildDailyBuckets, type DayBucket } from "@/lib/aggregates";
import { useBaby } from "@/lib/useBaby";
import { dailySleepNorm } from "@/lib/norms";
import { useExtendedEvents } from "@/lib/useEvents";

const RANGE_OPTIONS = [3, 7, 14, 30];

export function Trends({ events: liveEvents }: { events: BabyEvent[] }) {
  const [days, setDays] = useState(7);
  const { events, loadingMore } = useExtendedEvents(liveEvents, days);
  const baby = useBaby();

  const buckets = useMemo(
    () => buildDailyBuckets(events, days, new Date(), { inferBufferMin: 10 }),
    [events, days],
  );

  if (events.length === 0) return null;

  const milk = buckets.map((b) => b.milkMl);
  const sleepHrs = buckets.map((b) => b.sleepMinutes / 60);
  const feeds = buckets.map((b) => b.feeds);
  const wets = buckets.map((b) => b.wets);
  const dirties = buckets.map((b) => b.dirties);
  const pumpMl = buckets.map((b) => b.pumpMl);
  const meds = buckets.map((b) => b.meds);
  const hasMeds = meds.some((v) => v > 0);
  const hasTemps = buckets.some((b) => b.maxTempF !== null);

  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - baby.birthdate.getTime()) / 86400000),
  );
  const sleepRef = dailySleepNorm(ageDays);

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted">
            Daily totals
          </h2>
          {loadingMore && (
            <span className="text-[9px] text-muted italic">loading older…</span>
          )}
        </div>
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
        title="Wets"
        unit="count"
        values={wets}
        buckets={buckets}
        formatValue={(v) => (v ? `${v}` : "")}
      />
      <DailyBars
        title="Dirties"
        unit="count"
        values={dirties}
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
      {hasMeds && (
        <DailyBars
          title="Medications"
          unit="count"
          values={meds}
          buckets={buckets}
          formatValue={(v) => (v ? `${v}` : "")}
        />
      )}
      {hasTemps && <TempPeaks buckets={buckets} />}
    </div>
  );
}

function TempPeaks({ buckets }: { buckets: DayBucket[] }) {
  // Show the daily peak temperature with fever-aware coloring. Days without
  // a reading are skipped (no bar).
  const max = Math.max(
    HIGH_FEVER_THRESHOLD_F + 0.5,
    ...buckets.map((b) => b.maxTempF ?? 0),
  );
  const min = Math.min(97, ...buckets.flatMap((b) => (b.maxTempF !== null ? [b.maxTempF] : [])));
  const span = max - min || 1;

  return (
    <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Temperature</h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          peak/day · °F
        </span>
      </div>
      <div className="relative">
        <div
          className="grid gap-[2px] items-end"
          style={{
            gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
          }}
        >
          {buckets.map((b, i) => {
            const v = b.maxTempF;
            const pct = v !== null ? ((v - min) / span) * 100 : 0;
            const color =
              v === null
                ? "var(--color-sage-300)"
                : v >= HIGH_FEVER_THRESHOLD_F
                  ? "#dc2626"
                  : v >= FEVER_THRESHOLD_F
                    ? "#d97706"
                    : "var(--color-sage-300)";
            const isLatest = i === buckets.length - 1;
            return (
              <div key={i} className="flex flex-col items-center">
                <span
                  className={
                    "text-[10px] tabular-nums leading-tight h-4 " +
                    (isLatest ? "text-accent font-bold" : "text-muted")
                  }
                >
                  {v !== null ? v.toFixed(1) : ""}
                </span>
                <div className="w-full h-[60px] flex items-end">
                  <div
                    className="w-full rounded-t-md"
                    style={{
                      height:
                        v !== null ? `${Math.max(pct, 4)}%` : "0%",
                      background: color,
                      opacity: v === null ? 0 : 1,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="grid gap-[2px] mt-1"
        style={{
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
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
      <p className="text-[9px] text-muted text-right mt-1">
        amber = fever (≥100.4°F) · red = high fever (≥102.2°F)
      </p>
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
