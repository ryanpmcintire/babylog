"use client";

import { useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import { formatWeightGrams } from "@/lib/events";
import { LILY_BIRTHDATE } from "@/lib/age";

const DAYS_PROJECTION = 14;
const REGRESSION_MIN_DAY = 7;

type WeightPoint = {
  date: Date;
  grams: number;
  dayOfLife: number;
};

function shortWeight(g: number): string {
  const pounds = g / 453.59237;
  const totalOz = g / 28.349523125;
  const lb = Math.floor(pounds);
  const oz = Math.round(totalOz - lb * 16);
  const oz16 = oz === 16 ? 0 : oz;
  const lbOut = oz === 16 ? lb + 1 : lb;
  return `${lbOut} lb ${oz16} oz`;
}

export function WeightChart({ events }: { events: BabyEvent[] }) {
  const [hovered, setHovered] = useState<WeightPoint | null>(null);

  const points = useMemo<WeightPoint[]>(() => {
    const weights: WeightPoint[] = [];
    for (const e of events) {
      if (e.type !== "weight") continue;
      const d = e.occurred_at.toDate();
      const dayOfLife =
        (d.getTime() - LILY_BIRTHDATE.getTime()) / (1000 * 60 * 60 * 24);
      weights.push({ date: d, grams: e.weight_grams, dayOfLife });
    }
    return weights.sort((a, b) => a.dayOfLife - b.dayOfLife);
  }, [events]);

  if (points.length === 0) {
    return (
      <div className="w-full rounded-3xl border border-accent-soft bg-surface p-5 shadow-sm flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">
          Weight
        </h2>
        <p className="text-sm text-muted">
          No weights logged yet. Add one from Settings.
        </p>
      </div>
    );
  }

  const latest = points[points.length - 1]!;

  const regressionPoints = points.filter(
    (p) => p.dayOfLife >= REGRESSION_MIN_DAY,
  );
  const projection: { dayOfLife: number; grams: number; date: Date }[] = [];
  let gPerDay: number | null = null;
  if (regressionPoints.length >= 2) {
    const n = regressionPoints.length;
    const sumX = regressionPoints.reduce((a, p) => a + p.dayOfLife, 0);
    const sumY = regressionPoints.reduce((a, p) => a + p.grams, 0);
    const sumXY = regressionPoints.reduce(
      (a, p) => a + p.dayOfLife * p.grams,
      0,
    );
    const sumXX = regressionPoints.reduce(
      (a, p) => a + p.dayOfLife * p.dayOfLife,
      0,
    );
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    gPerDay = slope;
    for (let d = 0; d <= DAYS_PROJECTION; d++) {
      const dayOfLife = latest.dayOfLife + d;
      const projDate = new Date(latest.date);
      projDate.setDate(projDate.getDate() + d);
      projection.push({
        dayOfLife,
        grams: Math.round(slope * dayOfLife + intercept),
        date: projDate,
      });
    }
  }

  const domainEndDayOfLife = Math.max(
    latest.dayOfLife + (projection.length ? DAYS_PROJECTION : 0),
    7,
  );
  const allGrams = [
    ...points.map((p) => p.grams),
    ...projection.map((p) => p.grams),
  ];
  const minG = Math.min(...allGrams);
  const maxG = Math.max(...allGrams);
  const yPad = Math.max(200, (maxG - minG) * 0.15);
  const yMin = Math.max(0, minG - yPad);
  const yMax = maxG + yPad;

  const chartW = 320;
  const chartH = 140;
  const padX = 8;
  const padY = 6;

  const xFor = (dol: number) =>
    padX +
    (dol / Math.max(1, domainEndDayOfLife)) * (chartW - padX * 2);
  const yFor = (g: number) =>
    chartH - padY - ((g - yMin) / Math.max(1, yMax - yMin)) * (chartH - padY * 2);

  const actualPath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${xFor(p.dayOfLife).toFixed(1)} ${yFor(p.grams).toFixed(1)}`,
    )
    .join(" ");

  const projectionPath = projection.length
    ? projection
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"}${xFor(p.dayOfLife).toFixed(1)} ${yFor(p.grams).toFixed(1)}`,
        )
        .join(" ")
    : "";

  return (
    <div className="w-full rounded-3xl border border-accent-soft bg-surface p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">Weight</h2>
        {gPerDay != null && (
          <span className="text-[10px] text-muted">
            ≈ {gPerDay > 0 ? "+" : ""}
            {Math.round(gPerDay)} g/day
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-accent">
          {formatWeightGrams(latest.grams)}
        </span>
      </div>
      <div className="text-[10px] text-muted">
        as of{" "}
        {latest.date.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
        {" "}(day {Math.round(latest.dayOfLife)})
      </div>

      <div className="flex items-stretch gap-2">
        {/* Y-axis labels aligned with top/bottom of chart */}
        <div
          className="flex flex-col justify-between items-end text-[9px] text-muted tabular-nums shrink-0"
          style={{ height: 140, minWidth: 52 }}
        >
          <span>{shortWeight(Math.round(yMax))}</span>
          <span>{shortWeight(Math.round(yMin))}</span>
        </div>

        <div className="relative flex-1">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          preserveAspectRatio="none"
          className="w-full h-[140px]"
          aria-label="Weight over time"
        >
          {/* Top and bottom axis reference lines */}
          <line
            x1={padX}
            x2={chartW - padX}
            y1={yFor(yMax)}
            y2={yFor(yMax)}
            stroke="var(--divider)"
            strokeWidth="0.5"
          />
          <line
            x1={padX}
            x2={chartW - padX}
            y1={yFor(yMin)}
            y2={yFor(yMin)}
            stroke="var(--divider)"
            strokeWidth="0.5"
          />
          {/* Horizontal gridline at latest */}
          <line
            x1={padX}
            x2={chartW - padX}
            y1={yFor(latest.grams)}
            y2={yFor(latest.grams)}
            stroke="var(--color-accent)"
            strokeWidth="0.5"
            strokeDasharray="2 3"
            opacity="0.4"
          />

          {projectionPath && (
            <path
              d={projectionPath}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={actualPath}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {points.map((p, i) => (
            <circle
              key={i}
              cx={xFor(p.dayOfLife)}
              cy={yFor(p.grams)}
              r={hovered === p ? "5" : "3"}
              fill="var(--color-accent)"
              stroke="var(--marker-halo)"
              strokeWidth="1.5"
              style={{ cursor: "pointer" }}
              onPointerEnter={() => setHovered(p)}
              onPointerLeave={() => setHovered(null)}
            />
          ))}

          {projection.length > 0 && (
            <line
              x1={xFor(latest.dayOfLife)}
              x2={xFor(latest.dayOfLife)}
              y1={padY}
              y2={chartH - padY}
              stroke="var(--foreground)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              opacity="0.4"
            />
          )}
        </svg>

        {hovered && (
          <div
            className="absolute rounded-lg border border-accent-soft bg-surface px-2 py-1 text-[10px] text-foreground shadow-md pointer-events-none whitespace-nowrap tabular-nums"
            style={{
              left: `${(xFor(hovered.dayOfLife) / chartW) * 100}%`,
              top: `${(yFor(hovered.grams) / chartH) * 100}%`,
              transform: "translate(-50%, -120%)",
              zIndex: 5,
            }}
          >
            <div className="font-semibold">
              {formatWeightGrams(hovered.grams)}
            </div>
            <div className="text-muted">
              {hovered.date.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              {" · day "}
              {Math.round(hovered.dayOfLife)}
            </div>
          </div>
        )}
        </div>
      </div>

      <div
        className="flex justify-between text-[9px] text-muted"
        style={{ marginLeft: 60 }}
      >
        <span>birth</span>
        <span>day {Math.round(domainEndDayOfLife)}</span>
      </div>

      {points.length < 2 && (
        <p className="text-[10px] text-muted italic">
          Log a few more weights over the coming days for a growth projection.
        </p>
      )}
      {regressionPoints.length < 2 && points.length >= 2 && (
        <p className="text-[10px] text-muted italic">
          Projection appears once you have two or more weights from day{" "}
          {REGRESSION_MIN_DAY}+ (newborns commonly dip before recovering, so
          early points aren&rsquo;t used).
        </p>
      )}
    </div>
  );
}
