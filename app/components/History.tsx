"use client";

import { useMemo } from "react";
import type { BabyEvent } from "@/lib/events";
import { sideLabel } from "@/lib/events";
import { formatLiveElapsed, formatVolume } from "@/lib/format";
import { softDeleteEvent } from "@/lib/useEvents";
import { useAuth } from "../providers";
import { SwipeableRow } from "./SwipeableRow";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

type HistoryRow =
  | { kind: "event"; at: Date; event: BabyEvent }
  | {
      kind: "sleep";
      at: Date;
      startedAt: Date;
      endedAt: Date | null;
      actor: string;
      startId: string;
      endId: string | null;
    };

function firstName(email: string | null | undefined): string {
  if (!email) return "—";
  const local = email.split("@")[0] ?? email;
  return local.split(".")[0]!.charAt(0).toUpperCase() + local.split(".")[0]!.slice(1);
}

function describe(event: BabyEvent): { label: string; detail?: string } {
  switch (event.type) {
    case "breast_feed": {
      const outcomeText =
        event.outcome === "latched_fed"
          ? "latched & fed"
          : event.outcome === "latched_brief"
            ? "latched briefly"
            : "didn't latch";
      const side = sideLabel(event.side);
      return {
        label: "Breast feed",
        detail: side ? `${side} · ${outcomeText}` : outcomeText,
      };
    }
    case "bottle_feed":
      return {
        label: "Bottle",
        detail:
          formatVolume(event.volume_ml) +
          " · " +
          event.milk_types
            .map((m) =>
              m === "mom_pumped" ? "Mom" : m === "donor" ? "Donor" : "Formula",
            )
            .join(" + "),
      };
    case "pump": {
      const side = sideLabel(event.side);
      return {
        label: "Pump",
        detail: side
          ? `${side} · ${formatVolume(event.volume_ml)}`
          : formatVolume(event.volume_ml),
      };
    }
    case "diaper_wet":
      return { label: "Wet diaper" };
    case "diaper_dirty":
      return { label: "Dirty diaper" };
    case "sleep_start":
      return { label: "Sleep started" };
    case "sleep_end":
      return { label: "Woke up" };
  }
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildRows(events: BabyEvent[]): HistoryRow[] {
  // events ordered newest-first. Pair sleep_end with its prior sleep_start.
  const rows: HistoryRow[] = [];
  const consumedStartIds = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;

    if (e.type === "sleep_end") {
      // Find nearest earlier sleep_start without a matching end.
      const startIdx = events.findIndex(
        (s, j) => j > i && s.type === "sleep_start" && !consumedStartIds.has(s.id),
      );
      if (startIdx !== -1) {
        const start = events[startIdx]!;
        consumedStartIds.add(start.id);
        rows.push({
          kind: "sleep",
          at: e.occurred_at.toDate(),
          startedAt: start.occurred_at.toDate(),
          endedAt: e.occurred_at.toDate(),
          actor: firstName(e.created_by_email),
          startId: start.id,
          endId: e.id,
        });
        continue;
      }
    }

    if (e.type === "sleep_start" && consumedStartIds.has(e.id)) continue;

    rows.push({ kind: "event", at: e.occurred_at.toDate(), event: e });
  }

  return rows;
}

export function History({ events }: { events: BabyEvent[] }) {
  const { user } = useAuth();
  const groups = useMemo(() => {
    const rows = buildRows(events);
    const byDay = new Map<string, { label: string; rows: HistoryRow[] }>();
    for (const row of rows) {
      const key = dayKey(row.at);
      if (!byDay.has(key)) {
        byDay.set(key, { label: dayLabel(row.at), rows: [] });
      }
      byDay.get(key)!.rows.push(row);
    }
    return Array.from(byDay.values());
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="w-full rounded-3xl border border-accent-soft bg-surface p-6 text-center">
        <p className="text-sm text-muted">
          No events yet. Tap a button above to log the first one.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-5">
      <h2 className="text-xs uppercase tracking-[0.2em] text-muted text-center">
        History
      </h2>
      {groups.map((g) => (
        <section key={g.label} className="w-full flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted px-1">{g.label}</p>
          <div className="overflow-hidden rounded-2xl border border-accent-soft bg-surface divide-y divide-accent-soft">
            {g.rows.map((row, idx) => {
              const canDelete = canUserDelete(row, user?.uid);
              const item = <HistoryItem row={row} />;
              if (canDelete) {
                return (
                  <SwipeableRow
                    key={rowKey(row, idx)}
                    onDelete={() => deleteRow(row)}
                  >
                    {item}
                  </SwipeableRow>
                );
              }
              return <div key={rowKey(row, idx)}>{item}</div>;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function rowKey(row: HistoryRow, idx: number): string {
  if (row.kind === "event") return row.event.id;
  return `sleep-${row.startedAt.getTime()}-${idx}`;
}

function canUserDelete(row: HistoryRow, uid: string | undefined): boolean {
  if (!uid) return false;
  if (row.kind === "event") {
    const ageMs = Date.now() - row.event.occurred_at.toDate().getTime();
    return ageMs >= 0 && ageMs <= EDIT_WINDOW_MS;
  }
  // Sleep pair: the start event is older; if its age is within 24h,
  // the end is automatically within 24h too.
  const ageMs = Date.now() - row.startedAt.getTime();
  return ageMs >= 0 && ageMs <= EDIT_WINDOW_MS;
}

async function deleteRow(row: HistoryRow): Promise<void> {
  if (row.kind === "event") {
    await softDeleteEvent(row.event.id);
    return;
  }
  await softDeleteEvent(row.startId);
  if (row.endId) await softDeleteEvent(row.endId);
}

function HistoryItem({ row }: { row: HistoryRow }) {
  if (row.kind === "sleep") {
    const durationMs = (row.endedAt ?? new Date()).getTime() - row.startedAt.getTime();
    return (
      <div className="flex items-baseline gap-3 px-4 py-3">
        <span className="w-14 shrink-0 text-sm tabular-nums text-muted">
          {timeLabel(row.endedAt ?? row.startedAt)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Slept {formatLiveElapsed(durationMs)}
          </p>
          <p className="text-xs text-muted truncate">
            {timeLabel(row.startedAt)} → {row.endedAt ? timeLabel(row.endedAt) : "ongoing"}
          </p>
        </div>
        <span className="text-xs text-muted shrink-0">{row.actor}</span>
      </div>
    );
  }

  const e = row.event;
  const info = describe(e);
  const actor = firstName(e.created_by_email);
  return (
    <div className="flex items-baseline gap-3 px-4 py-3">
      <span className="w-14 shrink-0 text-sm tabular-nums text-muted">
        {timeLabel(row.at)}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{info.label}</p>
        {info.detail && (
          <p className="text-xs text-muted truncate">{info.detail}</p>
        )}
      </div>
      <span className="text-xs text-muted shrink-0">{actor}</span>
    </div>
  );
}
