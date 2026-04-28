"use client";

import { useEffect, useMemo, useState } from "react";
import type { BabyEvent } from "@/lib/events";
import {
  explicitSleepWindows,
  inferredSleepWindows,
  estimateNextEvent,
} from "@/lib/aggregates";
import { useBaby } from "@/lib/useBaby";
import { EditEventSheet } from "./EditEventSheet";

const CX = 100;
const CY = 100;
const R_OUTER = 92;
const R_SLEEP = 82;
const R_FEED = 62;
const R_DIAPER = 48;
const R_INNER_MASK = 38;

const COLORS = {
  sleep: "var(--color-sage-300)",
  feed: "#bd7d7d",
  diaper: "#7689b8",
};

function polar(minutes: number, radius: number): { x: number; y: number } {
  const angle = (minutes / 1440) * 2 * Math.PI - Math.PI / 2;
  return {
    x: CX + radius * Math.cos(angle),
    y: CY + radius * Math.sin(angle),
  };
}

function arcPath(
  startMin: number,
  endMin: number,
  radius: number,
): string {
  const a = polar(startMin, radius);
  const b = polar(endMin, radius);
  const large = endMin - startMin > 720 ? 1 : 0;
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function clampToToday(
  w: { start: Date; end: Date },
  todayStart: Date,
  todayEnd: Date,
): { startMin: number; endMin: number } | null {
  const s = w.start < todayStart ? todayStart : w.start;
  const e = w.end > todayEnd ? todayEnd : w.end;
  if (e <= s) return null;
  const startMin = (s.getTime() - todayStart.getTime()) / 60000;
  const endMin = (e.getTime() - todayStart.getTime()) / 60000;
  return { startMin, endMin };
}

export function TodayClock({ events }: { events: BabyEvent[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [editingId, setEditingId] = useState<string | null>(null);
  const baby = useBaby();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const {
    sleepArcs,
    feedDots,
    diaperDots,
    todayStart,
    predictedNextFeedMin,
  } = useMemo(() => {
    const todayStart = startOfToday();
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const sleepWindows = [
      ...explicitSleepWindows(events, new Date(now)),
      ...inferredSleepWindows(events, 10, new Date(now)),
    ];
    const sleepArcs: { startMin: number; endMin: number }[] = [];
    for (const w of sleepWindows) {
      const clamped = clampToToday(w, todayStart, todayEnd);
      if (clamped) sleepArcs.push(clamped);
    }

    const feedDots: { min: number; id: string }[] = [];
    const diaperDots: { min: number; id: string }[] = [];
    for (const e of events) {
      const at = e.occurred_at.toDate();
      if (at < todayStart || at >= todayEnd) continue;
      const min =
        at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
      if (e.type === "breast_feed" || e.type === "bottle_feed") {
        feedDots.push({ min, id: e.id });
      } else if (
        e.type === "diaper_wet" ||
        e.type === "diaper_dirty" ||
        e.type === "diaper_mixed"
      ) {
        diaperDots.push({ min, id: e.id });
      }
    }

    const nextFeed = estimateNextEvent(
      events,
      ["breast_feed", "bottle_feed"],
      8,
      15 * 60 * 1000,
    );
    let predictedNextFeedMin: number | null = null;
    if (nextFeed) {
      const nextAt = nextFeed.nextAt;
      if (nextAt >= todayStart && nextAt < todayEnd) {
        predictedNextFeedMin =
          nextAt.getHours() * 60 + nextAt.getMinutes();
      }
    }

    return {
      sleepArcs,
      feedDots,
      diaperDots,
      todayStart,
      predictedNextFeedMin,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, now]);

  const nowDate = new Date(now);
  const nowMin =
    nowDate.getHours() * 60 + nowDate.getMinutes() + nowDate.getSeconds() / 60;
  const nowIsToday =
    nowDate.getFullYear() === todayStart.getFullYear() &&
    nowDate.getMonth() === todayStart.getMonth() &&
    nowDate.getDate() === todayStart.getDate();

  const editingEvent = editingId
    ? events.find((e) => e.id === editingId) ?? null
    : null;

  const hasAny = sleepArcs.length || feedDots.length || diaperDots.length;

  const dayOfLife = Math.max(
    1,
    Math.floor((now - baby.birthdate.getTime()) / 86400000) + 1,
  );

  return (
    <div className="w-full rounded-3xl border border-accent-soft bg-surface p-4 shadow-sm flex flex-col items-center gap-2">
      <div className="w-full flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted">
            Today
          </h2>
          <span className="text-[10px] text-muted font-semibold tabular-nums">
            day {dayOfLife}
          </span>
        </div>
        <div className="flex gap-3 text-[10px] text-muted items-center">
          <LegendPill color={COLORS.sleep} label="sleep" opacity={0.7} />
          <LegendPill color={COLORS.feed} label="feed" />
          <LegendPill color={COLORS.diaper} label="diaper" />
        </div>
      </div>

      <svg
        viewBox="-28 -28 256 256"
        className="w-full max-w-[300px] h-auto"
        role="img"
        aria-label="Today's events on a 24-hour clock"
        style={{ fontFamily: "var(--font-nunito), system-ui, sans-serif" }}
      >
        <defs>
          <radialGradient id="clockFace" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="var(--accent-soft)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-soft)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sleepGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-sage-300)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--color-sage-300)" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {/* Radial gradient face */}
        <circle cx={CX} cy={CY} r={R_OUTER} fill="url(#clockFace)" />

        {/* Hour ticks every 3h + labels at 0/6/12/18 */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
          const tickMin = h * 60;
          const major = h % 6 === 0;
          const outer = polar(tickMin, R_OUTER);
          const inner = polar(tickMin, R_OUTER - (major ? 5 : 2.5));
          return (
            <line
              key={h}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke="var(--muted)"
              strokeWidth={major ? 1 : 0.5}
              opacity={major ? 0.45 : 0.28}
            />
          );
        })}
        {[
          { h: 0, label: "24" },
          { h: 6, label: "6" },
          { h: 12, label: "12" },
          { h: 18, label: "18" },
        ].map(({ h, label }) => {
          const p = polar(h * 60, R_OUTER + 10);
          return (
            <text
              key={h}
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted"
              style={{ fontSize: 9, fontWeight: 500 }}
            >
              {label}
            </text>
          );
        })}

        {/* Sleep arcs — soft halo + primary stroke for subtle depth */}
        {sleepArcs.map((a, i) => (
          <g key={`s${i}`}>
            <path
              d={arcPath(a.startMin, a.endMin, R_SLEEP)}
              fill="none"
              stroke="url(#sleepGlow)"
              strokeWidth="11"
              strokeLinecap="butt"
              opacity="0.25"
            />
            <path
              d={arcPath(a.startMin, a.endMin, R_SLEEP)}
              fill="none"
              stroke={COLORS.sleep}
              strokeWidth="7"
              strokeLinecap="butt"
              opacity="0.8"
            />
          </g>
        ))}

        {/* Predicted next-feed ghost dot */}
        {predictedNextFeedMin != null && nowIsToday && (() => {
          const p = polar(predictedNextFeedMin, R_FEED);
          return (
            <circle
              cx={p.x}
              cy={p.y}
              r="4"
              fill="none"
              stroke={COLORS.feed}
              strokeWidth="1"
              strokeDasharray="1.5 1.5"
              opacity="0.55"
            />
          );
        })()}

        {/* Current-time tick */}
        {nowIsToday && (
          <>
            <line
              x1={polar(nowMin, R_INNER_MASK).x}
              y1={polar(nowMin, R_INNER_MASK).y}
              x2={polar(nowMin, R_OUTER).x}
              y2={polar(nowMin, R_OUTER).y}
              stroke="var(--foreground)"
              strokeWidth="1"
              opacity="0.7"
            />
            <circle
              cx={polar(nowMin, R_OUTER).x}
              cy={polar(nowMin, R_OUTER).y}
              r="3"
              fill="var(--foreground)"
            />
            <circle
              cx={polar(nowMin, R_OUTER).x}
              cy={polar(nowMin, R_OUTER).y}
              r="5"
              fill="var(--foreground)"
              opacity="0.2"
            />
          </>
        )}

        {/* Feed dots */}
        {feedDots.map((d) => {
          const p = polar(d.min, R_FEED);
          return (
            <g key={d.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r="12"
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => setEditingId(d.id)}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r="4"
                fill={COLORS.feed}
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* Diaper dots */}
        {diaperDots.map((d) => {
          const p = polar(d.min, R_DIAPER);
          return (
            <g key={d.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r="12"
                fill="transparent"
                style={{ cursor: "pointer" }}
                onClick={() => setEditingId(d.id)}
              />
              <circle
                cx={p.x}
                cy={p.y}
                r="3.5"
                fill={COLORS.diaper}
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* Center: current time */}
        {nowIsToday && (
          <text
            x={CX}
            y={CY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-foreground"
            style={{ fontSize: 16, fontWeight: 700 }}
          >
            {nowDate.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </text>
        )}
      </svg>

      {!hasAny && (
        <p className="text-xs text-muted italic">
          Nothing logged yet today.
        </p>
      )}

      {editingEvent && (
        <EditEventSheet
          event={editingEvent}
          events={events}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}

function LegendPill({
  color,
  label,
  opacity = 1,
}: {
  color: string;
  label: string;
  opacity?: number;
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color, opacity }}
      />
      {label}
    </span>
  );
}
