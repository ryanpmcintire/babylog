"use client";

import { useEffect, useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import { FEVER_THRESHOLD_F, HIGH_FEVER_THRESHOLD_F } from "@/lib/events";
import {
  buildMarkers,
  buildSleepSegments,
  dayKeyOf,
  type Marker,
  type SleepSegment,
} from "@/lib/aggregates";
import { useExtendedEvents, VIEWS_FLAG_ENABLED } from "@/lib/useEvents";
import { EditEventSheet } from "./EditEventSheet";

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

export function Timeline({
  events: liveEvents,
  insightsView,
}: {
  events: BabyEvent[];
  insightsView?: import("@/lib/views").InsightsView | null;
}) {
  // Gate fallback fetches on VIEWS_FLAG_ENABLED itself (not view-loaded
  // state) so we don't briefly fire useExtendedEvents during the initial
  // view-loading window on app boot.
  const useView = VIEWS_FLAG_ENABLED;
  const viewLoaded = VIEWS_FLAG_ENABLED && insightsView != null;
  const [days, setDays] = useState(7);
  const [tick, setTick] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const extended = useExtendedEvents(useView ? [] : liveEvents, useView ? 0 : days);
  const events = useView ? liveEvents : extended.events;
  const loadingMore = useView ? false : extended.loadingMore;
  const editingEvent = editingId
    ? events.find((e) => e.id === editingId) ?? null
    : null;
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const now = new Date(tick);

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
    let sleeps: SleepSegment[] = [];
    let markers: Marker[] = [];
    if (viewLoaded && insightsView) {
      const dayKeys = new Set(dayList.map((d) => d.key));
      sleeps = (insightsView.sleep_segments ?? []).filter((s) =>
        dayKeys.has(s.dayKey),
      );
      markers = (insightsView.markers ?? [])
        .filter((m) => m.kind !== "pump")
        .filter((m) => dayKeys.has(m.dayKey));
    } else if (!useView) {
      sleeps = buildSleepSegments(events, now, { inferBufferMin: 10 });
      markers = buildMarkers(events).filter((m) => m.kind !== "pump");
    }
    // viewLoaded false but useView true → empty arrays (still loading);
    // user briefly sees an empty timeline until insightsView resolves.
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
  }, [useView, insightsView, events, dayList]);

  if (!useView && events.length === 0) return null;
  // When views are on and the view is loaded but truly empty, hide.
  // While loading, render the chrome with empty rows rather than null.
  if (
    viewLoaded &&
    (insightsView?.markers?.length ?? 0) === 0 &&
    (insightsView?.sleep_segments?.length ?? 0) === 0
  )
    return null;

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
      <div className="flex items-center justify-between gap-2">
        <Legend />
        {loadingMore && (
          <span className="text-[9px] text-muted italic">loading older…</span>
        )}
      </div>
      <div className="flex flex-col gap-0 mt-2">
        <AxisRow />
        {dayList.map((d, idx) => (
          <DayRow
            key={d.key}
            label={d.label}
            sleeps={sleepByDay.get(d.key) ?? []}
            markers={markersByDay.get(d.key) ?? []}
            days={days}
            isToday={idx === 0}
            nowMin={
              idx === 0 ? now.getHours() * 60 + now.getMinutes() : null
            }
            onMarkerClick={setEditingId}
          />
        ))}
      </div>

      {editingEvent && (
        <EditEventSheet
          event={editingEvent}
          events={liveEvents}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

const NIGHT_START_HOUR = 20;
const NIGHT_END_HOUR = 6;

function DayNightBackdrop({ withIcons = false }: { withIcons?: boolean }) {
  return (
    <>
      <span
        className="absolute top-0 bottom-0 pointer-events-none flex items-center justify-center"
        style={{
          left: 0,
          width: `${(NIGHT_END_HOUR / 24) * 100}%`,
          background: "rgba(29, 25, 48, 0.08)",
        }}
      >
        {withIcons && <MoonGlyph size={14} />}
      </span>
      <span
        className="absolute top-0 bottom-0 pointer-events-none flex items-center justify-center"
        style={{
          left: `${(NIGHT_START_HOUR / 24) * 100}%`,
          right: 0,
          background: "rgba(29, 25, 48, 0.08)",
        }}
      >
        {withIcons && <MoonGlyph size={14} />}
      </span>
    </>
  );
}

function MoonGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ opacity: 0.45, color: "var(--muted)" }}
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        fill="currentColor"
      />
    </svg>
  );
}

const MARKER_COLORS = {
  sleep: "var(--color-sage-400)",
  feed: "#bd7d7d", // rose — warm pink
  diaper: "#7689b8", // dusty periwinkle blue — cool, opposite the warm feed pink
  diaperMixed: "#8a6fa8", // muted plum — between feed pink and diaper blue
  pump: "#c49b5b", // ochre gold — warm but yellow, distinct from feed red
  medication: "#7c8d68", // moss green — distinct from feed/diaper, calm
  tempNormal: "#9ca3af", // neutral grey — non-fever readings
  tempFever: "#d97706", // amber
  tempHigh: "#dc2626", // rose
};

function Legend() {
  return (
    <div className="flex gap-3 flex-wrap text-[10px] text-muted items-center">
      <span className="flex items-center gap-1">
        <span
          className="inline-block w-4 h-2 rounded-full"
          style={{
            background: MARKER_COLORS.sleep,
            opacity: 0.7,
          }}
        />
        sleep
      </span>
      <LegendDot color={MARKER_COLORS.feed} label="feed" />
      <LegendDot color={MARKER_COLORS.diaper} label="diaper" />
      <LegendDot color={MARKER_COLORS.diaperMixed} label="mixed" />
      <LegendDot color={MARKER_COLORS.medication} label="med" />
      <LegendDot color={MARKER_COLORS.tempFever} label="temp" />
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
    <div className="relative h-5 ml-10 border-b border-accent-soft/60 overflow-hidden">
      <DayNightBackdrop withIcons />
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
  isToday,
  nowMin,
  onMarkerClick,
}: {
  label: string;
  sleeps: SleepSegment[];
  markers: Marker[];
  days: number;
  isToday?: boolean;
  nowMin?: number | null;
  onMarkerClick: (eventId: string) => void;
}) {
  const { rowHeight, padY } = rowMetrics(days);

  // Detect adjacency: sort segments by start; if one ends ~where another starts,
  // square off the touching ends so they read as one continuous bar.
  const CONNECT_EPSILON = 2; // minutes
  const sortedByStart = [...sleeps].sort((a, b) => a.startMin - b.startMin);
  const connections = new Map<SleepSegment, { left: boolean; right: boolean }>();
  for (let i = 0; i < sortedByStart.length; i++) {
    const cur = sortedByStart[i]!;
    const prev = sortedByStart[i - 1];
    const next = sortedByStart[i + 1];
    connections.set(cur, {
      left: !!prev && Math.abs(cur.startMin - prev.endMin) <= CONNECT_EPSILON,
      right: !!next && Math.abs(next.startMin - cur.endMin) <= CONNECT_EPSILON,
    });
  }

  return (
    <div className="flex items-center" style={{ height: rowHeight }}>
      <div className="w-10 text-[10px] text-muted truncate">{label}</div>
      <div className="relative flex-1 h-full">
        <div
          className="absolute inset-0"
          style={{ overflow: "hidden" }}
        >
        {sortedByStart.map((s, i) => {
          const conn = connections.get(s) ?? { left: false, right: false };
          return (
            <div
              key={`s${i}`}
              className="absolute"
              style={{
                left: `${(s.startMin / 1440) * 100}%`,
                width: `${((s.endMin - s.startMin) / 1440) * 100}%`,
                top: padY,
                bottom: padY,
                background: "var(--color-sage-300)",
                opacity: s.ongoing ? 0.5 : 0.7,
                border: "2px solid var(--marker-halo)",
                borderLeftWidth: conn.left ? 0 : 2,
                borderRightWidth: conn.right ? 0 : 2,
                borderTopLeftRadius: conn.left ? 0 : 999,
                borderBottomLeftRadius: conn.left ? 0 : 999,
                borderTopRightRadius: conn.right ? 0 : 999,
                borderBottomRightRadius: conn.right ? 0 : 999,
              }}
              title={`Sleep ${minutesToLabel(s.startMin)} – ${minutesToLabel(s.endMin)}${s.ongoing ? " (ongoing)" : ""}`}
            />
          );
        })}

        {markers.map((m, i) => (
          <MarkerDot
            key={`m${i}`}
            marker={m}
            days={days}
            onClick={() => onMarkerClick(m.eventId)}
          />
        ))}
        </div>

        {isToday && nowMin != null && (
          <span
            className="absolute pointer-events-none"
            style={{
              left: `${(nowMin / 1440) * 100}%`,
              top: 0,
              width: 0,
              height: 0,
              transform: "translate(-50%, -100%)",
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "6px solid var(--foreground)",
              zIndex: 2,
            }}
            title={`Now — ${minutesToLabel(nowMin)}`}
          />
        )}
      </div>
    </div>
  );
}

function markerVisuals(marker: Marker): {
  color: string;
  topPercent: number;
  shape: "dot" | "square";
  label: string;
} {
  switch (marker.kind) {
    case "breast":
    case "bottle":
      return { color: MARKER_COLORS.feed, topPercent: 22, shape: "dot", label: "feed" };
    case "diaper_wet":
    case "diaper_dirty":
    case "diaper_mixed":
      return {
        color:
          marker.kind === "diaper_mixed"
            ? MARKER_COLORS.diaperMixed
            : MARKER_COLORS.diaper,
        topPercent: 50,
        shape: "dot",
        label:
          marker.kind === "diaper_wet"
            ? "wet"
            : marker.kind === "diaper_dirty"
              ? "dirty"
              : "mixed",
      };
    case "pump":
      return { color: MARKER_COLORS.pump, topPercent: 75, shape: "dot", label: "pump" };
    case "medication":
      return {
        color: MARKER_COLORS.medication,
        topPercent: 78,
        shape: "square",
        label: "med",
      };
    case "temperature": {
      const f = marker.tempF ?? 0;
      const color =
        f >= HIGH_FEVER_THRESHOLD_F
          ? MARKER_COLORS.tempHigh
          : f >= FEVER_THRESHOLD_F
            ? MARKER_COLORS.tempFever
            : MARKER_COLORS.tempNormal;
      return { color, topPercent: 88, shape: "square", label: `${f.toFixed(1)}°F` };
    }
  }
}

function MarkerDot({
  marker,
  days,
  onClick,
}: {
  marker: Marker;
  days: number;
  onClick: () => void;
}) {
  const { color, topPercent, shape, label } = markerVisuals(marker);
  const size = days <= 7 ? 8 : days <= 14 ? 7 : 6;
  const hit = Math.max(size + 12, 22);

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute flex items-center justify-center"
      style={{
        left: `${(marker.atMin / 1440) * 100}%`,
        top: `${topPercent}%`,
        width: hit,
        height: hit,
        transform: "translate(-50%, -50%)",
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
      aria-label={`${label} at ${minutesToLabel(marker.atMin)}`}
      title={`${label} at ${minutesToLabel(marker.atMin)}`}
    >
      <span
        className="pointer-events-none"
        style={{
          width: size,
          height: size,
          background: color,
          borderRadius: shape === "dot" ? "9999px" : "2px",
        }}
      />
    </button>
  );
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const ampm = h < 12 ? "a" : "p";
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${mm.toString().padStart(2, "0")}${ampm}`;
}
