"use client";

import { useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import {
  buildMarkers,
  buildSleepSegments,
  dayKeyOf,
  type Marker,
  type SleepSegment,
} from "@/lib/aggregates";

const AXIS_TICKS = [0, 6, 12, 18, 24];
const TIMELINE_RANGES = [3, 7, 14, 30];

function rowMetrics(days: number): { rowHeight: number; padY: number } {
  if (days <= 7) return { rowHeight: 40, padY: 8 };
  if (days <= 14) return { rowHeight: 26, padY: 4 };
  return { rowHeight: 18, padY: 3 };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shortDayLabel(d: Date, today: Date): string {
  const diffDays = Math.round(
    (startOfDay(today).getTime() - startOfDay(d).getTime()) / 86400000,
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yest";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function Timeline({ events }: { events: BabyEvent[] }) {
  const [days, setDays] = useState(7);
  const now = new Date();

  const dayList = useMemo(() => {
    const out: { date: Date; key: string; label: string }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const day = startOfDay(d);
      out.push({
        date: day,
        key: dayKeyOf(day),
        label: shortDayLabel(day, now),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, events.length]);

  const { sleepByDay, markersByDay } = useMemo(() => {
    const sleeps = buildSleepSegments(events, now);
    const markers = buildMarkers(events);
    const sMap = new Map<string, SleepSegment[]>();
    const mMap = new Map<string, Marker[]>();
    for (const s of sleeps) {
      const arr = sMap.get(s.dayKey) ?? [];
      arr.push(s);
      sMap.set(s.dayKey, arr);
    }
    for (const m of markers) {
      const arr = mMap.get(m.dayKey) ?? [];
      arr.push(m);
      mMap.set(m.dayKey, arr);
    }
    return { sleepByDay: sMap, markersByDay: mMap };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  if (events.length === 0) return null;

  return (
    <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted">
          Timeline
        </h2>
        <div className="flex gap-1">
          {TIMELINE_RANGES.map((r) => (
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
      <Legend />
      <div className="flex flex-col gap-0 mt-2">
        <AxisRow />
        {dayList.map((d) => (
          <DayRow
            key={d.key}
            label={d.label}
            sleeps={sleepByDay.get(d.key) ?? []}
            markers={markersByDay.get(d.key) ?? []}
            days={days}
          />
        ))}
      </div>
    </div>
  );
}

const MARKER_COLORS = {
  sleep: "var(--color-sage-400)",
  feed: "#bd7d7d", // rose — warm, distinct from sleep green
  diaper: "#c49b5b", // amber — distinct earthy tone
  pump: "#7b8ea3", // slate — distinct cool tone
};

function Legend() {
  return (
    <div className="flex gap-3 flex-wrap text-[10px] text-muted">
      <LegendDot color={MARKER_COLORS.sleep} label="sleep" />
      <LegendDot color={MARKER_COLORS.feed} label="feed" />
      <LegendDot color={MARKER_COLORS.diaper} label="diaper" />
      <LegendDot color={MARKER_COLORS.pump} label="pump" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function AxisRow() {
  return (
    <div className="relative h-5 ml-10 border-b border-accent-soft/60">
      {AXIS_TICKS.map((h) => (
        <span
          key={h}
          className="absolute top-0 text-[10px] text-muted -translate-x-1/2"
          style={{ left: `${(h / 24) * 100}%` }}
        >
          {h === 0 || h === 24 ? "" : `${h}:00`}
        </span>
      ))}
    </div>
  );
}

function DayRow({
  label,
  sleeps,
  markers,
  days,
}: {
  label: string;
  sleeps: SleepSegment[];
  markers: Marker[];
  days: number;
}) {
  const { rowHeight, padY } = rowMetrics(days);
  return (
    <div className="flex items-center" style={{ height: rowHeight }}>
      <div className="w-10 text-[10px] text-muted truncate">{label}</div>
      <div className="relative flex-1 h-full">
        {AXIS_TICKS.slice(1, -1).map((h) => (
          <span
            key={h}
            className="absolute top-0 bottom-0 w-px bg-accent-soft/40"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {sleeps.map((s, i) => (
          <div
            key={`s${i}`}
            className="absolute rounded-full"
            style={{
              left: `${(s.startMin / 1440) * 100}%`,
              width: `${((s.endMin - s.startMin) / 1440) * 100}%`,
              top: padY,
              bottom: padY,
              background: "var(--color-sage-400)",
              opacity: s.ongoing ? 0.55 : 0.9,
            }}
            title={`Sleep ${minutesToLabel(s.startMin)} – ${minutesToLabel(s.endMin)}${s.ongoing ? " (ongoing)" : ""}`}
          />
        ))}

        {markers.map((m, i) => (
          <MarkerDot key={`m${i}`} marker={m} days={days} />
        ))}
      </div>
    </div>
  );
}

function MarkerDot({ marker, days }: { marker: Marker; days: number }) {
  const color =
    marker.kind === "breast" || marker.kind === "bottle"
      ? MARKER_COLORS.feed
      : marker.kind === "pump"
        ? MARKER_COLORS.pump
        : MARKER_COLORS.diaper;

  const baseSize =
    marker.kind === "pump" ||
    marker.kind === "diaper_wet" ||
    marker.kind === "diaper_dirty"
      ? 7
      : 9;
  const size = days <= 7 ? baseSize : days <= 14 ? baseSize - 2 : baseSize - 3;

  return (
    <span
      className="absolute rounded-full border border-white/50 shadow-sm"
      style={{
        left: `${(marker.atMin / 1440) * 100}%`,
        top: "50%",
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        background: color,
      }}
      title={`${marker.kind} at ${minutesToLabel(marker.atMin)}`}
    />
  );
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const ampm = h < 12 ? "a" : "p";
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${mm.toString().padStart(2, "0")}${ampm}`;
}
